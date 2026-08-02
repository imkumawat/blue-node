import { verifyAccessToken } from "../lib/tokenService.js";

export interface AuthUser {
  userId: string;
  scopes: string[];
  exp: number;
  sessionId: string; // from token `sid` claim — server-generated per login
  // From the token `gid` claim. Non-null only when this token was issued to an
  // OAuth client under the user's grant; null for a first-party session. The MCP
  // auth guard uses it to check whether that grant has since been revoked.
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
    userId: payload.sub,
    scopes: payload.scopes ?? [],
    // jti: payload.jti,
    exp: payload.exp ?? 0,
    sessionId: payload.sid,
    //  grantId: payload.gid ?? null,
  };
}
