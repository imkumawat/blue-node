import { verifyAccessToken } from "../lib/tokenStore.js";
import { InvalidTokenError } from "../errors.js";
import type { AuthUser } from "../types.js";

/**
 * Verifies a first-party session token — REST, GraphQL and the WS upgrade.
 *
 * Opaque, so verification is a Redis lookup rather than a signature check. There
 * is no audience argument because there is nothing to disambiguate: one token
 * family, one recipient (this API). An "admin" is a user holding admin_access, not
 * a separate population, so privilege is a scope check further down the chain —
 * never a different kind of token.
 *
 * Throws rather than returning null: every caller treats an unusable token as a
 * rejected request, and a throw makes that impossible to forget.
 */
export async function verifySessionToken(rawToken: string): Promise<AuthUser> {
  const record = await verifyAccessToken(rawToken);
  if (!record) throw new InvalidTokenError();

  return {
    id: record.userId,
    scopes: record.scopes,
    sessionId: record.sessionId,
    exp: record.exp,
  };
}
