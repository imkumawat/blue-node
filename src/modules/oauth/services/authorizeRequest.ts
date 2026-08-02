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
  response_type: string;
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
    response_type: input.response_type,
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
 * Scopes are space-delimited (RFC 6749).
 *
 * What the client registered plays TWO roles here, and they are easy to
 * conflate:
 *
 *   default  the request may omit `scope`, in which case the registered set is
 *            used — the RFC's "the server may use a default"
 *   ceiling  the request may never exceed the registered set, whether it named
 *            scopes or not
 *
 * The ceiling is the part that matters. Without it, a client registers for one
 * thing and then asks for another at authorize time, and the only barrier left
 * is a user clicking Allow on a screen that names powers the client never
 * declared.
 *
 * NOTE: this bounds a client to its OWN registration, which stops an honest
 * client from over-asking and a stolen client_id from being widened. It is not
 * yet a bound on what may be delegated at all — registration is open (DCR) and
 * unclamped, so a client can still declare a broad set for itself. Clamping
 * registration against a server-side delegatable allowlist is the other half,
 * and is deliberately still to do.
 *
 * An empty result is an error rather than an empty grant: every tool requires a
 * scope, so a token carrying none could not call anything. Failing here is far
 * easier to diagnose than a token that authenticates fine and is refused by
 * every single tool.
 */
function resolveRequestedScopes(
  requested: string | undefined,
  clientRegistered: string | null,
): Scope[] {
  const registered = new Set(
    (clientRegistered ?? "").split(" ").filter(Boolean),
  );

  // Registering no scope is a statement, not an omission: the client asked for
  // no capability, so there is no ceiling to fit under and nothing it can ever
  // be granted. Saying so here beats letting it through to fail later at every
  // single tool call.
  if (registered.size === 0) {
    throw new AuthorizeRedirectError(
      "invalid_scope",
      "This client registered no scopes and cannot request any",
    );
  }

  const raw = (requested ?? clientRegistered ?? "").split(" ").filter(Boolean);

  if (raw.length === 0) {
    throw new AuthorizeRedirectError("invalid_scope", "No scope requested");
  }

  // Checked before the ceiling on purpose: "that is not a scope" and "that is
  // not YOUR scope" are different mistakes, and answering with the wrong one
  // sends the client looking in the wrong place.
  const unknown = raw.filter((s) => !isScope(s));
  if (unknown.length > 0) {
    throw new AuthorizeRedirectError(
      "invalid_scope",
      `Unknown scope: ${unknown.join(", ")}`,
    );
  }

  const beyondRegistration = raw.filter((s) => !registered.has(s));
  if (beyondRegistration.length > 0) {
    throw new AuthorizeRedirectError(
      "invalid_scope",
      `Scope not registered for this client: ${beyondRegistration.join(", ")}`,
    );
  }

  return [...new Set(raw.filter(isScope))];
}

/** What /authorize does next, once the user behind the session is known. */
export interface ConsentDecision {
  needsConsent: boolean;
  existingGrant: OauthGrant | null;
  requiredGrants: Scope[];
}

export async function resolveGrant(params: {
  userId: string;
  clientId: string;
  requestedScopes: Scope[];
}): Promise<ConsentDecision> {
  const existingGrant = await findGrant(params.userId, params.clientId);

  const alreadyGranted = new Set(existingGrant?.scopes ?? []);
  const needsConsent = !params.requestedScopes.every((s) =>
    alreadyGranted.has(s),
  );
  const requiredGrants = params.requestedScopes.filter(
    (s) => !alreadyGranted.has(s),
  );

  return { needsConsent, existingGrant, requiredGrants };
}
