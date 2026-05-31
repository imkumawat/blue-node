# blue-node

Production-grade Node.js backend in TypeScript. Express + Drizzle + Redis + GraphQL (Apollo) + WebSocket.

## Requirements

- Node.js >= 22
- PostgreSQL
- Redis
- MongoDB

## Database users (least privilege)

Never run the app as the database master/superuser (`postgres`, MySQL `root`,
Mongo `atlasAdmin`/`root`). Create a **dedicated app user** with only the
data-operation privileges the app needs, scoped to a single database. If app
credentials leak, the blast radius stays contained — the user can touch its own
data but cannot drop databases, manage users, or read other databases.

Conventions:

- **Runtime user** — `SELECT/INSERT/UPDATE/DELETE` only (no DDL, no superuser). This is what goes in `.env`.
- **Migration user** (optional) — `CREATE/ALTER/DROP` for schema changes; used by migration scripts only.
- Use **separate users per environment** (dev / staging / prod). Store prod credentials in AWS Secrets Manager, not `.env`.

### PostgreSQL

```sql
CREATE ROLE bluenode_app WITH LOGIN PASSWORD 'change-me';
GRANT CONNECT ON DATABASE graphql_crud TO bluenode_app;
GRANT USAGE ON SCHEMA public TO bluenode_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO bluenode_app;
-- Cover tables created later, too:
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO bluenode_app;
```

### MySQL

```sql
CREATE USER 'bluenode_app'@'%' IDENTIFIED BY 'change-me';
GRANT SELECT, INSERT, UPDATE, DELETE ON graphql_crud.* TO 'bluenode_app'@'%';
FLUSH PRIVILEGES;
```

### MongoDB

```js
// run in `mongosh` against the target cluster
use bluenode;
db.createUser({
  user: "bluenode_app",
  pwd: "change-me",
  roles: [{ role: "readWrite", db: "bluenode" }], // NOT atlasAdmin / dbAdmin / root
});
```

> **Atlas UI:** Database Access → Add New Database User → Built-in role
> **Read and write to any database** is too broad — pick **Specific Privileges**
> → `readWrite` on `bluenode` only. Also allowlist your IP under **Network Access**.

## Scripts

| Script                 | Purpose                                                 |
| ---------------------- | ------------------------------------------------------- |
| `npm run dev`          | Start dev server (nodemon + tsx, kills port 4000 first) |
| `npm run build`        | Compile TS → `dist/`                                    |
| `npm start`            | Run compiled `dist/server.js`                           |
| `npm run typecheck`    | `tsc --noEmit`                                          |
| `npm run lint:check`   | ESLint                                                  |
| `npm run lint:fix`     | ESLint with `--fix`                                     |
| `npm run format:check` | Prettier check                                          |
| `npm run format:fix`   | Prettier write                                          |

## CI

Two pipelines run the same quality gates on every PR to `main`:

- **GitHub Actions** — `.github/workflows/ci.yml`
- **Azure DevOps** — `azure-pipelines.yml`

Gates: `typecheck` → `lint:check` → `format:check` → `build` → `vitest`.

> Unit tests run with `--passWithNoTests` until the first spec is added. Drop that flag once tests exist.

## Branch protection — UI setup required

CI files alone don't block merges. You must enable branch protection in the repo UI:

### GitHub

1. Repo → **Settings** → **Branches** → **Branch protection rules** → **Add rule**.
2. Branch name pattern: `main`.
3. Enable:
   - **Require a pull request before merging**
   - **Require status checks to pass before merging** → search and select `Quality Gates`
   - **Require branches to be up to date before merging** (recommended)
4. Save.

### Azure DevOps

1. **Repos** → **Branches** → find `main` → **…** → **Branch policies**.
2. Under **Build Validation**, click **+**.
3. Select the pipeline tied to `azure-pipelines.yml` → set **Trigger** to _Automatic_ → **Policy requirement**: _Required_.
4. Save.

Optional (recommended for both): require minimum reviewers, require linked work items, block direct pushes to `main`.
