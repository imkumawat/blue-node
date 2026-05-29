# blue-node

Production-grade Node.js backend in TypeScript. Express + Drizzle + Redis + GraphQL (Apollo) + WebSocket.

## Requirements

- Node.js >= 22
- PostgreSQL
- Redis

## Scripts

| Script | Purpose |
| --- | --- |
| `npm run dev` | Start dev server (nodemon + tsx, kills port 4000 first) |
| `npm run build` | Compile TS → `dist/` |
| `npm start` | Run compiled `dist/server.js` |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run lint:check` | ESLint |
| `npm run lint:fix` | ESLint with `--fix` |
| `npm run format:check` | Prettier check |
| `npm run format:fix` | Prettier write |

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
3. Select the pipeline tied to `azure-pipelines.yml` → set **Trigger** to *Automatic* → **Policy requirement**: *Required*.
4. Save.

Optional (recommended for both): require minimum reviewers, require linked work items, block direct pushes to `main`.
