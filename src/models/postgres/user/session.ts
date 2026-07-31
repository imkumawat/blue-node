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

/**
 * One row per signed-in DEVICE, for first-party sessions only.
 *
 * OAuth clients are NOT here — their equivalent is oauth_grants, anchored on a
 * (user, client) pair rather than on a device. Both tables have the same shape
 * though: one row that represents access, and deleting it cascades everything
 * issued under it away.
 *
 * This is what makes a "where you're logged in" screen possible at all. A JWT
 * cannot back that screen because there is nowhere to list from — which is the
 * strongest reason first-party tokens went opaque, stronger than revocation.
 */
export const sessions = pgTable(
  "sessions",
  {
    // This IS the `sid` every access token carries, and it is deliberately
    // STABLE across token rotation: refreshing mints a new access token against
    // the same session. That stability is what lets a device stay identifiable
    // in a list, and it is what per-session WebSocket disconnect keys off.
    id: uuid("id").$defaultFn(generateId).primaryKey(),

    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),

    // No portal/audience column, deliberately. An "admin" here is not a separate
    // population — there is one users table, and admin_access is a SCOPE. So a
    // second token family would model a distinction that does not exist. This is
    // also what Slack does: token TYPE says who is acting, admin capability is a
    // scope (admin.users:write), not a separate portal token.
    //
    // If admin ever needs tighter security than a customer, the answer is
    // step-up auth — require recent authentication on the sensitive route, the
    // way GitHub's sudo mode works — not a shorter session for everything. The
    // auth time for that check is createdAt below.

    // A LABEL, never identity. Derived from the User-Agent so a person can
    // recognise their own device in a list; nothing is ever authorised from it,
    // and a wrong guess costs nothing.
    deviceLabel: varchar("device_label", { length: 120 }),

    // Kept raw alongside the label so a better parser can backfill later, and so
    // an investigation has the original string rather than our summary of it.
    userAgent: text("user_agent"),

    // Nullable, unlike consent_log's: getClientIp can legitimately come back
    // empty on non-HTTP paths, and a session is worth recording without it.
    // 45 = longest IPv6 text form, same as consent_log.
    ipAddress: varchar("ip_address", { length: 45 }),

    // Updated on refresh only, never per request. A write on every authenticated
    // request would put Postgres in the hot path for no benefit; refresh already
    // touches the DB, so ~15-minute granularity is free and is plenty for a
    // screen that says "active 2 hours ago".
    lastUsedAt: timestamp("last_used_at", { withTimezone: true })
      .defaultNow()
      .notNull(),

    // Tracks the refresh-token lifetime and slides forward on each refresh: this
    // is how long the DEVICE may stay signed in, not how long one credential
    // lives. No default — the caller derives it from the configured refresh
    // lifetime, which the DB has no way to know.
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),

    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),

    // No updated_at: last_used_at already carries the only mutation anyone cares
    // about, and adding one would mean a trigger for a column nothing reads.
  },
  (table) => [
    // Powers both the "where you're logged in" list and revoke-all.
    index("sessions_user_id_idx").on(table.userId),

    // Powers the expiry sweep. Postgres will not add this for us, and without it
    // the sweep sequentially scans the whole table.
    index("sessions_expires_at_idx").on(table.expiresAt),
  ],
);

export type Session = typeof sessions.$inferSelect;
export type NewSession = typeof sessions.$inferInsert;

/*
  CREATE TABLE sessions (
    id            UUID PRIMARY KEY,
    user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    device_label  VARCHAR(120),
    user_agent    TEXT,
    ip_address    VARCHAR(45),
    last_used_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at    TIMESTAMPTZ NOT NULL,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
  CREATE INDEX sessions_user_id_idx    ON sessions(user_id);
  CREATE INDEX sessions_expires_at_idx ON sessions(expires_at);

  -- The sweep. Refresh tokens follow by FK cascade once refresh_tokens.session_id
  -- exists, so this row is the only one that has to be chased.
  --   DELETE FROM sessions WHERE expires_at < NOW();
*/
