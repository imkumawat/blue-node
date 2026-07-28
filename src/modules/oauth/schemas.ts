import { z } from "zod";

/**
 * Dynamic client registration payload (RFC 7591).
 *
 * Field names are snake_case because they are a WIRE format fixed by the RFC,
 * not our choice. The service maps them to the camelCase column names — that
 * mapping is the boundary, and it stays in one place.
 */
export const registerClientInput = z.object({
  client_name: z.string().min(1).max(255),

  // Plain strings, not z.url(): a native app may legitimately register a
  // private-use scheme such as com.example.app:/cb, which a URL validator aimed
  // at http(s) would reject. registerClient does the real check — it has to
  // distinguish https from loopback-http from custom-scheme anyway.
  redirect_uris: z.array(z.string().min(1)).min(1).max(10),

  grant_types: z
    .array(z.enum(["authorization_code", "refresh_token"]))
    .default(["authorization_code", "refresh_token"]),
  response_types: z.array(z.enum(["code"])).default(["code"]),
  token_endpoint_auth_method: z
    .enum(["none", "client_secret_basic", "client_secret_post"])
    .default("none"),

  scope: z.string().max(500).optional(),
  client_uri: z.url().optional(),
  logo_uri: z.url().optional(),
  software_id: z.string().max(255).optional(),
  software_version: z.string().max(64).optional(),
});

export type RegisterClientInput = z.infer<typeof registerClientInput>;

/**
 * /authorize query parameters.
 *
 * Deliberately shallow: this checks SHAPE (present, a string, plausible length),
 * not semantics. `response_type` and `code_challenge_method` are plain strings
 * rather than literals because a wrong value there must come back as an OAuth
 * redirect error (`unsupported_response_type`), and a zod failure would instead
 * surface as a 422 the client cannot interpret. The service judges meaning.
 */
export const authorizeInput = z.object({
  client_id: z.uuid(),
  redirect_uri: z.string().min(1),
  response_type: z.string().min(1),
  // RFC 7636: a base64url S256 challenge is always 43 characters; the range
  // leaves room for other methods to be rejected by the service with a proper
  // OAuth error rather than a validation failure.
  code_challenge: z.string().min(43).max(128),
  code_challenge_method: z.string().min(1),
  scope: z.string().max(500).optional(),
  state: z.string().max(500).optional(),
  resource: z.string().min(1).optional(),
});

export type AuthorizeInput = z.infer<typeof authorizeInput>;

/**
 * /token body for the authorization_code grant.
 *
 * `grant_type` IS a literal here, unlike the /authorize fields: an unsupported
 * grant is checked by the handler before parsing, so anything reaching this
 * schema is already known to be authorization_code.
 */
export const tokenInput = z.object({
  grant_type: z.literal("authorization_code"),
  code: z.string().min(1),
  code_verifier: z.string().min(43).max(128),
  client_id: z.uuid(),
  redirect_uri: z.string().min(1),
  resource: z.string().min(1).optional(),
});

export type TokenInput = z.infer<typeof tokenInput>;

/**
 * /token body for the refresh_token grant.
 *
 * `scope` may only NARROW what the grant already covers (RFC 6749 §6). Widening
 * is rejected by the service — a refresh token must never be a way to acquire
 * permission the user never approved.
 */
export const refreshTokenInput = z.object({
  grant_type: z.literal("refresh_token"),
  refresh_token: z.string().min(1),
  client_id: z.uuid(),
  scope: z.string().max(500).optional(),
  resource: z.string().min(1).optional(),
});

export type RefreshTokenInput = z.infer<typeof refreshTokenInput>;
