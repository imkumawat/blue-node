import { getEnvConfig } from "../../../config/env.js";
import { hmacSha256, randomToken } from "../../../shared/utils/crypto.js";
import { getScopes } from "../lib/permissionQueries.js";
import { InvalidRefreshTokenError } from "../errors.js";
import { issueAccessToken, revokeAccessToken } from "../lib/tokenStore.js";
import { rotateSession, touchSession } from "../lib/sessionQueries.js";
import type { SessionCredentials } from "./createSession.js";

/**
 * Issues a fresh access token against an EXISTING session — the refresh path.
 *
 * Preserving the session id is the point: a device stays the same device across
 * rotation, so it keeps its row in the login list and per-session WebSocket
 * disconnect keeps working across the access-token cycle.
 *
 * touchSession is the guard, not a courtesy. It slides the expiry AND claims the
 * row in one conditional statement, so a session signed out between the refresh
 * arriving and the token being minted returns null here. Minting anyway would
 * write a live token into Redis under a session id that no longer exists — and
 * nothing on the read path consults this table, so that orphan would keep working
 * until its TTL ran out.
 */
export async function renewSession(
  rawRefreshToken: string,
): Promise<SessionCredentials> {
  const { accessExpiry, refreshExpiry, refreshPrefix, pepper } =
    getEnvConfig().tokens;

  const tokenHash = hmacSha256(pepper, rawRefreshToken);
  const rotated = await rotateSession(tokenHash);

  // An OAuth client's refresh token must NEVER be redeemable here. Those rows
  // carry a grantId instead of a sessionId, and letting one through would turn a
  // token narrowed to, say, read_profile into a full first-party session cookie.
  // This is the mirror of the grantId check consumeGrantRefreshToken makes.
  if (!rotated) throw new InvalidRefreshTokenError();

  const { userId, id: sessionId } = rotated;
  await revokeAccessToken(sessionId); // revoke the previous access token before issuing a new one

  // Read fresh rather than carrying the old token's scopes forward, so a
  // permission revoked in the meantime stops being issued from this refresh on.
  const scopes = await getScopes(rotated.userId);

  const refreshToken = `${refreshPrefix}${randomToken(32)}`;

  const claimed = await touchSession(
    sessionId,
    hmacSha256(pepper, refreshToken),
    new Date(Date.now() + refreshExpiry * 1000),
  );
  if (!claimed) throw new InvalidRefreshTokenError();

  const accessExpiresAtSec = Math.floor(
    new Date(Date.now() + accessExpiry * 1000).getTime() / 1000,
  );

  const accessToken = await issueAccessToken({
    userId,
    sessionId,
    scopes,
    exp: accessExpiresAtSec,
  });

  return { accessToken, refreshToken };
}
