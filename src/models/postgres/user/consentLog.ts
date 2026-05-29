import {
  pgTable,
  uuid,
  varchar,
  text,
  timestamp,
  index,
} from "drizzle-orm/pg-core";
import { generateId } from "../../../utils/generateId.js";
import { users } from "./user.js";

export const consentLogs = pgTable(
  "consent_logs",
  {
    id: uuid("id").$defaultFn(generateId).primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    consentType: varchar("consent_type", { length: 50 }).notNull(),
    consentVersion: varchar("consent_version", { length: 20 }).notNull(),
    ipAddress: varchar("ip_address", { length: 45 }).notNull(),
    userAgent: text("user_agent"),
    platform: varchar("platform", { length: 20 }).notNull().default("web"),
    acceptedAt: timestamp("accepted_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [index("consent_logs_user_id_idx").on(table.userId)],
);

export type ConsentLog = typeof consentLogs.$inferSelect;
export type NewConsentLog = typeof consentLogs.$inferInsert;

/*
  CREATE TABLE consent_logs (
    id               UUID PRIMARY KEY,
    user_id          UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    consent_type     VARCHAR(50) NOT NULL,
    consent_version  VARCHAR(20) NOT NULL,
    ip_address       VARCHAR(45) NOT NULL,
    user_agent       TEXT,
    platform         VARCHAR(20) NOT NULL DEFAULT 'web',
    accepted_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
  CREATE INDEX consent_logs_user_id_idx ON consent_logs(user_id);
*/
