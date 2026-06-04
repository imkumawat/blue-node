import {
  pgTable,
  uuid,
  varchar,
  text,
  timestamp,
  index,
  pgEnum,
} from "drizzle-orm/pg-core";
import { generateId } from "../../../utils/generateId.js";

export const userStatusEnum = pgEnum("user_status", [
  "active",
  "inactive",
  "suspended",
  "pending", // signup → pending until email is verified
]);

export const users = pgTable(
  "users",
  {
    id: uuid("id").$defaultFn(generateId).primaryKey(),
    email: varchar("email", { length: 255 }).notNull().unique(),
    passwordHash: text("password_hash").notNull(),
    status: userStatusEnum("status").notNull().default("active"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    // DB trigger auto-sets updated_at on every UPDATE — do not set manually in queries
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [index("users_status_idx").on(table.status)],
);

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;

/*
  CREATE TYPE user_status AS ENUM ('active', 'inactive', 'suspended', 'pending');
  -- existing DB: ALTER TYPE user_status ADD VALUE IF NOT EXISTS 'pending';

  CREATE TABLE users (
    id            UUID PRIMARY KEY,
    email         VARCHAR(255) NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    status        user_status NOT NULL DEFAULT 'active',
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
  CREATE INDEX users_status_idx ON users(status);
*/
