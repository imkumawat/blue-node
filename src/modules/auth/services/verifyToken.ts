import { verifyAccessToken } from "../lib/tokenService.js";

export interface AuthUser {
  id: string;
  scopes: string[];
  jti: string;
  exp: number;
  sessionId?: string; // from token `sid` claim — server-generated per login; absent on legacy tokens
}

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
): Promise<AuthUser> {
  const payload = await verifyAccessToken(rawToken, audience);
  return {
    id: payload.sub,
    scopes: payload.scopes ?? [],
    jti: payload.jti,
    exp: payload.exp ?? 0,
    sessionId: payload.sid,
  };
}
