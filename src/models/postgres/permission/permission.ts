import { pgTable, uuid, varchar, text, timestamp } from "drizzle-orm/pg-core";
import { generateId } from "../../../utils/generateId.js";

export const permissions = pgTable("permissions", {
  id: uuid("id").$defaultFn(generateId).primaryKey(),
  scope: varchar("scope", { length: 100 }).notNull().unique(),
  description: text("description"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

export type Permission = typeof permissions.$inferSelect;
export type NewPermission = typeof permissions.$inferInsert;

/*
  CREATE TABLE permissions (
    id          UUID PRIMARY KEY,
    scope       VARCHAR(100) NOT NULL UNIQUE,
    description TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
*/
