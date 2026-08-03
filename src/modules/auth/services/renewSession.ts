import { getEnvConfig } from "../../../config/env.js";
import { hmacSha256, randomToken } from "../../../shared/utils/crypto.js";
import logger from "../../../utils/logger.js";
import { getScopes } from "../infra/permissionQueries.js";
import { InvalidRefreshTokenError } from "../errors.js";
import { issueAccessToken, revokeAccessToken } from "../infra/tokenStore.js";
import {
  findSessionByPreviousTokenHash,
  rotateSession,
  deleteSession,
} from "../infra/sessionQueries.js";
import { disconnectSession } from "../../../websocket/index.js";
import type { SessionCredentials } from "./createSession.js";

/**
 * Issues a fresh access token against an EXISTING session — the refresh path.
 *
 * Preserving the session id is the point: a device stays the same device across
 * rotation, so it keeps its row in the login list and per-session WebSocket
 * disconnect keeps working across the access-token cycle.
 *
 * The rotation is one statement, and it is the guard rather than a courtesy: it
 * matches the presented hash, slides the expiry and installs the replacement
 * together. A session signed out between the refresh arriving and the token
 * being minted therefore matches nothing. Minting anyway would write a live
 * token into Redis under a session id that no longer exists, and nothing on the
 * read path consults this table, so that orphan would keep working to its TTL.
 *
 * An OAuth client's refresh token can never be redeemed here either: those live
 * in their own table, so there is no row for this lookup to find.
 */
export async function renewSession(
  rawRefreshToken: string,
): Promise<SessionCredentials> {
  const { accessExpiry, refreshExpiry, refreshPrefix, pepper } =
    getEnvConfig().tokens;

  const presentedHash = hmacSha256(pepper, rawRefreshToken);

  // Minted before the rotation because the replacement has to go into the same
  // statement that spends the old one. Thirty-two random bytes cost nothing if
  // the rotation then misses.
  const refreshToken = `${refreshPrefix}${randomToken(32)}`;

  const rotated = await rotateSession(
    presentedHash,
    hmacSha256(pepper, refreshToken),
    new Date(Date.now() + refreshExpiry * 1000),
  );

  if (!rotated) {
    await reportIfReuse(presentedHash);
    throw new InvalidRefreshTokenError();
  }

  const { userId, id: sessionId } = rotated;
  await revokeAccessToken(sessionId); // revoke the previous access token before issuing a new one

  // Read fresh rather than carrying the old token's scopes forward, so a
  // permission revoked in the meantime stops being issued from this refresh on.
  const scopes = await getScopes(userId);

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

/**
 * Records a refresh token being presented after it was already spent.
 *
 * Deliberately observe-only. The session is NOT killed: a client without
 * single-flight refresh produces this same signal from two tabs racing, and
 * logging a legitimate user out for that is worse than the thing it prevents.
 * What this does is make the event visible, so the planned step-up (challenge a
 * refresh arriving from an unfamiliar IP or device) has something to trigger on.
 *
 * A miss here is the ordinary case — an expired or simply invalid string — and
 * is not worth a line in the log.
 */
async function reportIfReuse(presentedHash: string): Promise<void> {
  const spent = await findSessionByPreviousTokenHash(presentedHash);
  if (!spent) return;

  await disconnectSession(spent.userId, spent.id);
  await revokeAccessToken(spent.id);
  await deleteSession(spent.id, spent.userId);

  logger.warn(
    {
      sessionId: spent.id,
      userId: spent.userId,
      deviceLabel: spent.deviceLabel,
      ipAddress: spent.ipAddress,
      lastUsedAt: spent.lastUsedAt,
    },
    "refresh token reuse: a token already spent by rotation was presented again",
  );
}
