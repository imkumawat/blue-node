import { pgTable, uuid, varchar, text, timestamp } from "drizzle-orm/pg-core";
import { generateId } from "../../../utils/generateId.js";

export const apiKeys = pgTable("api_keys", {
  id: uuid("id").$defaultFn(generateId).primaryKey(),
  keyHash: text("key_hash").notNull().unique(),
  keyPrefix: varchar("key_prefix", { length: 12 }).notNull(),
  clientName: varchar("client_name", { length: 100 }).notNull(),
  status: varchar("status", { length: 20 }).notNull().default("active"),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

export type ApiKey = typeof apiKeys.$inferSelect;
export type NewApiKey = typeof apiKeys.$inferInsert;

/*
  CREATE TYPE api_key_status AS ENUM ('active', 'revoked');

  CREATE TABLE api_keys (
    id           UUID PRIMARY KEY,
    key_hash     TEXT NOT NULL UNIQUE,
    key_prefix   VARCHAR(12) NOT NULL,
    client_name  VARCHAR(100) NOT NULL,
    status       api_key_status NOT NULL DEFAULT 'active',
    expires_at   TIMESTAMPTZ,
    last_used_at TIMESTAMPTZ,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
*/
