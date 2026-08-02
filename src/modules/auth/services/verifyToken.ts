import { verifyAccessToken } from "../lib/tokenService.js";

import type { AuthSession } from "../types.js";

/**
 * Verifies a JWT and returns the auth-context shape used everywhere
 * (REST middleware, GraphQL adapter, future CLI/worker if needed).
 *
 * Throws whatever tokenService throws (TokenExpiredError, InvalidTokenError,
 * TokenRevokedError). Callers decide how to handle (reject vs silent-fail).
 */
export async function verifyToken(
  rawToken: string,
  audience: string,
): Promise<AuthSession> {
  const payload = await verifyAccessToken(rawToken, audience);
  return {
    userId: payload.sub,
    scopes: payload.scopes ?? [],
    // jti: payload.jti,
    exp: payload.exp ?? 0,
    sessionId: payload.sid,
    //  grantId: payload.gid ?? null,
  };
}
