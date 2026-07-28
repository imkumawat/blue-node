import {
  pgTable,
  uuid,
  text,
  timestamp,
  index,
  unique,
} from "drizzle-orm/pg-core";
import { generateId } from "../../../utils/generateId.js";
import { users } from "../user/user.js";
import { oauthClients } from "./oauthClient.js";

/**
 * A user's standing consent for one OAuth client — the row behind a
 * "connected apps" screen.
 *
 * Distinct from a refresh token, and the distinction matters: a refresh token is
 * a CREDENTIAL for one session and is replaced on every rotation, while a grant
 * is the RELATIONSHIP and survives every rotation until the user revokes it. One
 * grant can have many live refresh tokens under it (one per device). Revoking
 * app access therefore means deleting the grant, not a token — which is why
 * refresh_tokens.grant_id cascades from here.
 */
export const oauthGrants = pgTable(
  "oauth_grants",
  {
    id: uuid("id").$defaultFn(generateId).primaryKey(),

    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),

    clientId: uuid("client_id")
      .notNull()
      .references(() => oauthClients.id, { onDelete: "cascade" }),

    // What the user ACTUALLY consented to — not what the client asked for at
    // registration. An array rather than space-delimited text because every read
    // is a subset test: is what this client is requesting now already covered? A
    // yes is what lets /authorize skip the consent screen; a no is what makes
    // incremental consent work.
    scopes: text("scopes").array().notNull(),

    // Touched when a token is issued under this grant. Powers the "last used"
    // column a connected-apps screen shows.
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),

    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    // "Show me my connected apps" is a lookup by user.
    index("oauth_grants_user_id_idx").on(table.userId),

    // One grant per user+client. Makes "has this user already approved this app?"
    // a single lookup, and makes granting an extra scope an UPDATE rather than a
    // second competing row.
    unique("oauth_grants_user_client_uniq").on(table.userId, table.clientId),
  ],
);

export type OauthGrant = typeof oauthGrants.$inferSelect;
export type NewOauthGrant = typeof oauthGrants.$inferInsert;

/*
  CREATE TABLE oauth_grants (
    id           UUID PRIMARY KEY,
    user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    client_id    UUID NOT NULL REFERENCES oauth_clients(id) ON DELETE CASCADE,
    scopes       TEXT[] NOT NULL,
    last_used_at TIMESTAMPTZ,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT oauth_grants_user_client_uniq UNIQUE (user_id, client_id)
  );

  CREATE INDEX oauth_grants_user_id_idx ON oauth_grants(user_id);

  -- REVOCATION MODEL
  -- Deleting a grant cascades to every refresh_token carrying its grant_id, so
  -- one DELETE ends the app's access on every device. Access tokens already
  -- issued are stateless JWTs and outlive that by up to their TTL, so each
  -- carries a `gid` claim and revocation also writes a Redis marker
  -- (oauth:grant:revoked:<gid>) with TTL = access-token TTL. authenticateMcp
  -- checks it for the same cost as the existing jti blacklist lookup, and the
  -- key expires on its own once no token from that grant can still be valid.
*/
