import { pgTable, uuid, char, timestamp, index } from "drizzle-orm/pg-core";
import { generateId } from "../../../utils/generateId.js";
import { oauthGrants } from "./oauthGrant.js";

/**
 * One row per authorization an OAuth client completed — the client-side twin of
 * `sessions`.
 *
 *   sessions              one signed-in DEVICE         holds that device's refresh token
 *   oauth_grant_sessions  one completed AUTHORIZATION  holds that connection's refresh token
 *
 * A grant is the RELATIONSHIP ("this user allows this app") and survives every
 * rotation. This is a CONNECTION under it, and there can be several: an app
 * authorized twice gets two rows, independently revocable, the same way two
 * devices get two session rows.
 *
 * Named oauth_grant_sessions rather than oauth_sessions so that "grant id" and
 * "grant-session id" never read as the same thing. Only the grant id ever
 * reaches a token, as the `gid` claim; this row's id stays server-side.
 *
 * A row per authorization, not per token. Row-per-token records the whole
 * rotation chain but grows on every refresh and needs pruning to stay bounded,
 * and the extra history buys nothing: the only replay worth catching is of the
 * token that was actually stolen. One generation back does that, and it makes
 * rotation here the SAME algorithm as on `sessions` instead of a second one.
 */
export const oauthGrantSessions = pgTable(
  "oauth_grant_sessions",
  {
    // Embedded in the refresh token itself (nf_grt_<id>.<secret>), so redeeming
    // one is a primary-key lookup rather than a scan on a hash — and a single
    // read can say whether the presented secret is the live one, the spent one,
    // or neither.
    id: uuid("id").$defaultFn(generateId).primaryKey(),

    // Deleting a grant ends the app's access on every connection at once, which
    // is what "revoke this app" has to mean.
    grantId: uuid("grant_id")
      .notNull()
      .references(() => oauthGrants.id, { onDelete: "cascade" }),

    // HMAC of the refresh token currently valid for this connection. Rotation
    // overwrites it, which is why the previous one is kept below.
    tokenHash: char("token_hash", { length: 64 }).notNull().unique(),

    // The hash this row held before the last rotation.
    //
    // Without it a replayed refresh token is indistinguishable from a random
    // string: rotation overwrote the hash, so the comparison simply fails. A
    // match here means a credential that WAS valid is being presented after it
    // was spent — the shape of a stolen token being replayed.
    //
    // Unlike the first-party path, that is unambiguous here. A browser can
    // produce this signal by racing two tabs; an OAuth client keeps a proper
    // token store and refreshes once, so reuse means the token leaked.
    previousTokenHash: char("previous_token_hash", { length: 64 }),

    // The access token currently PAIRED with this row's refresh token.
    //
    // Rotation retires a pair, not just a token: once the client has swapped its
    // refresh token, the access token it was handed alongside should stop working
    // too. Without these two columns there is no way to say which token that was
    // — access tokens are stateless and nothing else records them.
    //
    // The exp is kept because a denylist entry only needs to outlive the token it
    // denies. TTL = exp - now, so the key expires on its own and the list stays
    // bounded by revocations rather than growing with every rotation.
    accessTokenJti: uuid("access_token_jti"),
    accessTokenExp: timestamp("access_token_exp", { withTimezone: true }),

    // Updated on refresh only. Lets a connected-apps screen tell a live
    // connection from one authorized months ago that never came back.
    lastUsedAt: timestamp("last_used_at", { withTimezone: true })
      .defaultNow()
      .notNull(),

    // SLIDING: pushed forward on every refresh. How long this connection may
    // stay idle before it has to be re-authorized.
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),

    // ABSOLUTE: set once at creation and never moved.
    //
    // Without this a connection is immortal — an app that refreshes on schedule
    // slides the expiry forever and consent is never asked for again. The
    // sliding window is the convenience; this is the ceiling that says "however
    // active you are, come back and be re-authorized eventually". Auth0 and
    // Okta both carry the same pair for the same reason.
    absoluteExpiresAt: timestamp("absolute_expires_at", {
      withTimezone: true,
    }).notNull(),

    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    // Revoking a grant and listing an app's live connections both start here.
    index("oauth_grant_sessions_grant_id_idx").on(table.grantId),

    // Powers the expiry sweep, which would otherwise scan the whole table.
    index("oauth_grant_sessions_expires_at_idx").on(table.expiresAt),
  ],
);

export type OauthGrantSession = typeof oauthGrantSessions.$inferSelect;
export type NewOauthGrantSession = typeof oauthGrantSessions.$inferInsert;

/*
  CREATE TABLE oauth_grant_sessions (
    id                  UUID PRIMARY KEY,
    grant_id            UUID NOT NULL REFERENCES oauth_grants(id) ON DELETE CASCADE,
    token_hash          CHAR(64) NOT NULL UNIQUE,  -- HMAC of the live refresh token
    previous_token_hash CHAR(64),                  -- the one before the last rotation
    access_token_jti    UUID,                      -- the token paired with the live refresh token
    access_token_exp    TIMESTAMPTZ,               -- gives the denylist entry its TTL
    last_used_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at          TIMESTAMPTZ NOT NULL,      -- sliding
    absolute_expires_at TIMESTAMPTZ NOT NULL,      -- fixed at creation
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );

  CREATE INDEX oauth_grant_sessions_grant_id_idx   ON oauth_grant_sessions(grant_id);
  CREATE INDEX oauth_grant_sessions_expires_at_idx ON oauth_grant_sessions(expires_at);

  -- No index on previous_token_hash, unlike sessions: the refresh token carries
  -- this row's id, so the reuse check is a primary-key read rather than a lookup
  -- by hash.

  -- The sweep. Nothing hangs off these rows, so there is no cascade to chase.
  --   DELETE FROM oauth_grant_sessions
  --    WHERE expires_at < NOW() OR absolute_expires_at < NOW();
*/
