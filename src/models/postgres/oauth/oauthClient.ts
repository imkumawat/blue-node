import {
  pgTable,
  uuid,
  varchar,
  text,
  timestamp,
  index,
} from "drizzle-orm/pg-core";
import { generateId } from "../../../utils/generateId.js";

export const oauthClients = pgTable(
  "oauth_clients",
  {
    // This IS the client_id returned from dynamic registration — no separate
    // opaque identifier, same uuidv7 convention as every other primary key.
    id: uuid("id").$defaultFn(generateId).primaryKey(),

    clientName: varchar("client_name", { length: 255 }).notNull(),

    // Exact-match allowlist. A presented redirect_uri MUST be compared against
    // these byte-for-byte — prefix or wildcard matching is how open redirectors
    // get built, and the spec calls out open redirection specifically.
    redirectUris: text("redirect_uris").array().notNull(),

    grantTypes: text("grant_types").array().notNull(),
    responseTypes: text("response_types").array().notNull(),

    // 'none' = public client, protected by PKCE alone (what a desktop app
    // registers as). Otherwise confidential, with a secret. A DB CHECK keeps the
    // pairing with client_secret_hash honest — see the SQL below.
    tokenEndpointAuthMethod: varchar("token_endpoint_auth_method", {
      length: 32,
    }).notNull(),

    // SHA-256 of the secret, never the secret — same treatment as api_keys.
    // NULL for a public client.
    clientSecretHash: text("client_secret_hash"),

    // Space-delimited scopes requested AT REGISTRATION. Not what a token ends up
    // carrying: that is decided at /authorize by what the user consents to.
    scope: text("scope"),

    // Optional RFC 7591 metadata. Kept because the consent screen shows the
    // client's name and a link back to whoever is asking for access.
    clientUri: text("client_uri"),
    logoUri: text("logo_uri"),
    softwareId: varchar("software_id", { length: 255 }),
    softwareVersion: varchar("software_version", { length: 64 }),

    // Set when a token is first issued for this client. Registration is open, so
    // this doubles as the abuse signal and the prune key.
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),

    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [index("oauth_clients_last_used_at_idx").on(table.lastUsedAt)],
);

export type OauthClient = typeof oauthClients.$inferSelect;
export type NewOauthClient = typeof oauthClients.$inferInsert;

/*
  CREATE TABLE oauth_clients (
    id                         UUID PRIMARY KEY,
    client_name                VARCHAR(255) NOT NULL,
    redirect_uris              TEXT[] NOT NULL,
    grant_types                TEXT[] NOT NULL,
    response_types             TEXT[] NOT NULL,
    token_endpoint_auth_method VARCHAR(32) NOT NULL,
    client_secret_hash         TEXT,
    scope                      TEXT,
    client_uri                 TEXT,
    logo_uri                   TEXT,
    software_id                VARCHAR(255),
    software_version           VARCHAR(64),
    last_used_at               TIMESTAMPTZ,
    created_at                 TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- Enum-like without ALTER TYPE pain when a new auth method is supported.
    -- Not modelled by Drizzle above; this is a DB-level guard only.
    CONSTRAINT oauth_clients_auth_method_chk
      CHECK (token_endpoint_auth_method IN ('none','client_secret_basic','client_secret_post')),

    -- A public client must NOT have a secret (PKCE is its protection); a
    -- confidential one must. Enforced here so no code path can violate it.
    CONSTRAINT oauth_clients_secret_chk CHECK (
      (token_endpoint_auth_method =  'none' AND client_secret_hash IS NULL)
   OR (token_endpoint_auth_method <> 'none' AND client_secret_hash IS NOT NULL)
    )
  );

  CREATE INDEX oauth_clients_last_used_at_idx ON oauth_clients(last_used_at);

  -- OPTIONAL. RFC 7591 registration is open by design, so anyone can create
  -- rows. This reaps only clients that NEVER completed a token exchange; a
  -- client in real use has last_used_at set and is never touched. Window is
  -- generous on purpose — a client registered today and authorised next week
  -- must survive. Requires pg_cron in shared_preload_libraries on RDS.
  SELECT cron.schedule(
    'cleanup-oauth-clients',
    '30 * * * *',
    $$DELETE FROM oauth_clients
       WHERE last_used_at IS NULL AND created_at < NOW() - INTERVAL '30 days'$$
  );
*/
