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
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
  CREATE INDEX refresh_tokens_user_id_idx ON refresh_tokens(user_id);

  -- Auto-delete expired rows via pg_cron (requires pg_cron in shared_preload_libraries on RDS).
  -- Run once during DB setup; job persists across restarts.
  SELECT cron.schedule(
    'cleanup-refresh-tokens',
    '0 * * * *',
    $$DELETE FROM refresh_tokens WHERE expires_at < NOW()$$
  );
*/
