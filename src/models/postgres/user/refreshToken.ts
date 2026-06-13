import { pgTable, uuid, timestamp, index } from "drizzle-orm/pg-core";
import { generateId } from "../../../utils/generateId.js";
import { users } from "./user.js";

export const refreshTokens = pgTable(
  "refresh_tokens",
  {
    id: uuid("id").$defaultFn(generateId).primaryKey(),
    jti: uuid("jti").notNull().unique(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
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
    access_jti  UUID NOT NULL,
    access_exp  TIMESTAMPTZ NOT NULL,
    expires_at  TIMESTAMPTZ NOT NULL,
    rotated_at  TIMESTAMPTZ,                       -- NULL = live; set = already rotated
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
  CREATE INDEX refresh_tokens_user_id_idx ON refresh_tokens(user_id);

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
