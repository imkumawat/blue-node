import { pgTable, uuid, timestamp, index } from "drizzle-orm/pg-core";
import { generateId } from "../../../utils/generateId.js";
import { users } from "./user.js";
import { oauthGrants } from "../oauth/oauthGrant.js";

export const refreshTokens = pgTable(
  "refresh_tokens",
  {
    id: uuid("id").$defaultFn(generateId).primaryKey(),
    jti: uuid("jti").notNull().unique(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    // NULL = first-party session (a REST/GraphQL login). Set = this token was
    // issued to an OAuth client under that user's grant.
    //
    // The cascade is the "remove access" button: deleting one oauth_grants row
    // kills every refresh token that app holds, on every device, in a single
    // statement. That is why this points at the grant rather than the client —
    // the client id is reachable through the grant, and revocation is per
    // relationship, not per app-in-general.
    grantId: uuid("grant_id").references(() => oauthGrants.id, {
      onDelete: "cascade",
    }),
    accessJti: uuid("access_jti").notNull(),
    accessExp: timestamp("access_exp", { withTimezone: true }).notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    // NULL = live and never used. Set = this jti was consumed by a rotation;
    // any later presentation is reuse and must trip the family revoke. The row
    // is the sole source of truth for rotation state (no companion Redis key).
    rotatedAt: timestamp("rotated_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [index("refresh_tokens_user_id_idx").on(table.userId)],
);

export type RefreshToken = typeof refreshTokens.$inferSelect;
export type NewRefreshToken = typeof refreshTokens.$inferInsert;

/*
  CREATE TABLE refresh_tokens (
    id          UUID PRIMARY KEY,
    jti         UUID NOT NULL UNIQUE,
    user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    grant_id    UUID REFERENCES oauth_grants(id) ON DELETE CASCADE,  -- NULL = first-party session
    access_jti  UUID NOT NULL,
    access_exp  TIMESTAMPTZ NOT NULL,
    expires_at  TIMESTAMPTZ NOT NULL,
    rotated_at  TIMESTAMPTZ,                       -- NULL = live; set = already rotated
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
  CREATE INDEX refresh_tokens_user_id_idx ON refresh_tokens(user_id);
  -- Postgres does NOT index a referencing column automatically. Without this,
  -- deleting one oauth_grants row sequentially scans refresh_tokens to find the
  -- children to cascade. Required, not an optimisation.
  CREATE INDEX refresh_tokens_grant_id_idx ON refresh_tokens(grant_id);

  -- Existing DB migration for grant_id. The column add is metadata-only and
  -- non-blocking (nullable, no default). The FK is added NOT VALID first so it
  -- does not hold ACCESS EXCLUSIVE while scanning existing rows, then validated
  -- separately under a weaker lock:
  --   ALTER TABLE refresh_tokens ADD COLUMN grant_id UUID;
  --   ALTER TABLE refresh_tokens
  --     ADD CONSTRAINT refresh_tokens_grant_id_fkey
  --     FOREIGN KEY (grant_id) REFERENCES oauth_grants(id) ON DELETE CASCADE NOT VALID;
  --   ALTER TABLE refresh_tokens VALIDATE CONSTRAINT refresh_tokens_grant_id_fkey;
  --   CREATE INDEX refresh_tokens_grant_id_idx ON refresh_tokens(grant_id);

  -- Existing DB migration (nullable, no default => metadata-only, non-blocking):
  --   ALTER TABLE refresh_tokens ADD COLUMN rotated_at TIMESTAMPTZ;
  -- Cleanup stays unchanged: a rotated row's reuse-detection value lasts only
  -- until its JWT exp, and expires_at is untouched by rotation, so the hourly
  -- sweep below reaps rotated tombstones on the same schedule. Do NOT add an
  -- `OR rotated_at < ...` clause — an expired JWT is rejected by
  -- verifyRefreshToken before the DB is queried, so earlier deletion buys nothing.

  -- Auto-delete expired rows via pg_cron (requires pg_cron in shared_preload_libraries on RDS).
  -- Run once during DB setup; job persists across restarts.
  SELECT cron.schedule(
    'cleanup-refresh-tokens',
    '0 * * * *',
    $$DELETE FROM refresh_tokens WHERE expires_at < NOW()$$
  );
*/
