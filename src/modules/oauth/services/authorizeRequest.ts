import { getEnvConfig } from "../../../config/env.js";
import { SCOPES } from "../../../shared/constants/scopes.js";
import type { Scope } from "../../../shared/constants/scopes.js";
import { findClientById } from "../lib/clientQueries.js";
import { findGrant } from "../lib/grantQueries.js";
import {
  AuthorizeRedirectError,
  InvalidRedirectUriError,
  UnknownClientError,
} from "../errors.js";
import type { AuthorizeInput } from "../schemas.js";
import type { OauthClient } from "../../../models/postgres/oauth/oauthClient.js";
import type { OauthGrant } from "../../../models/postgres/oauth/oauthGrant.js";

const ALL_SCOPES = new Set<string>(Object.values(SCOPES));

function isScope(value: string): value is Scope {
  return ALL_SCOPES.has(value);
}

/** An /authorize request that has passed every check except "who is the user". */
export interface ValidatedAuthorizeRequest {
  client: OauthClient;
  redirectUri: string;
  scopes: Scope[];
  codeChallenge: string;
  codeChallengeMethod: "S256";
  resource: string;
  state: string | null;
}

/**
 * Validates an /authorize request.
 *
 * Order is deliberate. The client and the redirect URI are checked FIRST and
 * throw errors that must not redirect (see AuthorizeRedirectError for why).
 * Only once the redirect URI is known to be one this client registered does
 * anything else run, because only then is it safe to send a user there.
 */
export async function validateAuthorizeRequest(
  input: AuthorizeInput,
): Promise<ValidatedAuthorizeRequest> {
  const client = await findClientById(input.client_id);
  if (!client) throw new UnknownClientError();

  // Exact match, not prefix and not "starts with". This single comparison is
  // what stands between the authorization code and an attacker-controlled
  // callback, so it stays byte-for-byte.
  if (!client.redirectUris.includes(input.redirect_uri)) {
    throw new InvalidRedirectUriError(
      "redirect_uri does not exactly match a registered URI for this client",
    );
  }

  // ── past this line, failures redirect back to the client ──────────────────

  if (input.response_type !== "code") {
    throw new AuthorizeRedirectError(
      "unsupported_response_type",
      "Only response_type=code is supported",
    );
  }

  if (input.code_challenge_method !== "S256") {
    throw new AuthorizeRedirectError(
      "invalid_request",
      "code_challenge_method must be S256",
    );
  }

  const resource = resolveResource(input.resource);
  const scopes = resolveRequestedScopes(input.scope, client.scope);

  return {
    client,
    redirectUri: input.redirect_uri,
    scopes,
    codeChallenge: input.code_challenge,
    codeChallengeMethod: "S256",
    resource,
    state: input.state ?? null,
  };
}

/**
 * RFC 8707 resource indicator.
 *
 * MCP clients MUST send it; general OAuth clients often don't. With exactly one
 * protected resource, defaulting is unambiguous and keeps those clients working.
 * When a second resource is added this becomes "required" — one line, and the
 * default disappears rather than silently binding a token to the wrong audience.
 */
function resolveResource(requested: string | undefined): string {
  const { mcp } = getEnvConfig();
  if (!mcp.resourceUri) {
    throw new Error("MCP_RESOURCE_URI must be set to issue OAuth tokens");
  }

  if (requested === undefined) return mcp.resourceUri;

  if (requested !== mcp.resourceUri) {
    throw new AuthorizeRedirectError(
      "invalid_target",
      "Unknown resource indicator",
    );
  }

  return requested;
}

/**
 * Scopes are space-delimited (RFC 6749). Falling back to what the client
 * registered mirrors the RFC's "the server may use a default".
 *
 * An empty result is an error rather than an empty grant: every tool requires a
 * scope, so a token carrying none could not call anything. Failing here is far
 * easier to diagnose than a token that authenticates fine and is refused by
 * every single tool.
 */
function resolveRequestedScopes(
  requested: string | undefined,
  clientDefault: string | null,
): Scope[] {
  const raw = (requested ?? clientDefault ?? "").split(" ").filter(Boolean);

  if (raw.length === 0) {
    throw new AuthorizeRedirectError(
      "invalid_scope",
      "No scope requested and the client has no default scope",
    );
  }

  const unknown = raw.filter((s) => !isScope(s));
  if (unknown.length > 0) {
    throw new AuthorizeRedirectError(
      "invalid_scope",
      `Unknown scope: ${unknown.join(", ")}`,
    );
  }

  return [...new Set(raw.filter(isScope))];
}

/** What /authorize does next, once the user behind the session is known. */
export interface ConsentDecision {
  /** Scopes to actually grant — requested, narrowed to what the user holds. */
  grantable: Scope[];
  /** False when an existing grant already covers all of them. */
  needsConsent: boolean;
  existingGrant: OauthGrant | null;
}

/**
 * Decides whether the consent screen has to be shown.
 *
 * Two narrowings happen here, and they are different things. A user cannot
 * delegate permission they do not hold, so the request is first intersected with
 * the user's own scopes. What remains is then compared against any standing
 * grant: fully covered means this app was already approved for all of it and the
 * screen is skipped; anything new means asking again — which is what makes
 * incremental consent work instead of silently widening an old approval.
 */
export async function resolveConsent(params: {
  userId: string;
  userScopes: string[];
  clientId: string;
  requestedScopes: Scope[];
}): Promise<ConsentDecision> {
  const held = new Set(params.userScopes);
  const grantable = params.requestedScopes.filter((s) => held.has(s));

  if (grantable.length === 0) {
    throw new AuthorizeRedirectError(
      "invalid_scope",
      "You do not have permission to grant any of the requested scopes",
    );
  }

  const existingGrant = await findGrant(params.userId, params.clientId);
  const alreadyGranted = new Set(existingGrant?.scopes ?? []);
  const needsConsent = !grantable.every((s) => alreadyGranted.has(s));

  return { grantable, needsConsent, existingGrant };
}
