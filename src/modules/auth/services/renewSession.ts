import { getEnvConfig } from "../../../config/env.js";
import logger from "../../../utils/logger.js";
import { getScopes } from "../infra/permissionQueries.js";
import { InvalidRefreshTokenError } from "../errors.js";
import {
  hashRefreshToken,
  issueAccessToken,
  mintRotatedRefreshToken,
  parseRefreshToken,
  revokeAccessToken,
} from "../infra/tokenStore.js";
import {
  findSession,
  rotateSession,
  deleteSession,
} from "../infra/sessionQueries.js";
import { disconnectSocketConnection } from "../../../websocket/index.js";
import type { SessionCredentials } from "./createSession.js";
import type { Session } from "../../../models/postgres/user/session.js";

/**
 * Issues a fresh access token against an EXISTING session — the refresh path.
 *
 * Preserving the session id is the point: a device stays the same device across
 * rotation, so it keeps its row in the login list and per-session WebSocket
 * disconnect keeps working across the access-token cycle.
 *
 * The refresh token carries the session's id, so redeeming one starts as a
 * primary-key read — and that single read is enough to say whether the presented
 * secret is the live one, the one already spent, or neither. The rotation that
 * follows is still the guard: it matches the secret again, slides the expiry and
 * installs the replacement in one statement, so a session signed out in between
 * matches nothing. Minting anyway would write a live token into Redis under a
 * session id that no longer exists, and nothing on the read path consults this
 * table, so that orphan would keep working to its TTL.
 *
 * An OAuth client's refresh token can never be redeemed here: it carries a
 * different prefix, so it fails to parse rather than failing to be found.
 */
export async function renewSession(
  rawRefreshToken: string,
): Promise<SessionCredentials> {
  const { accessExpiry, refreshExpiry } = getEnvConfig().tokens;

  const parsed = parseRefreshToken(rawRefreshToken);
  if (!parsed) throw new InvalidRefreshTokenError();

  const session = await findSession(parsed.sessionId);
  if (!session) throw new InvalidRefreshTokenError();

  const presentedHash = hashRefreshToken(rawRefreshToken);

  if (presentedHash !== session.tokenHash) {
    await revokeOnReuse(session, presentedHash).catch((err: unknown) => {
      logger.error({ err }, "reuse handling failed");
    });
    throw new InvalidRefreshTokenError();
  }

  const replacement = mintRotatedRefreshToken(session.id);

  const rotated = await rotateSession(
    session.id,
    presentedHash,
    replacement.tokenHash,
    new Date(Date.now() + refreshExpiry * 1000),
  );

  // Lost the claim, or the session expired between the read and the write. Not
  // reuse — the secret matched a moment ago — so nothing is revoked here.
  if (!rotated) throw new InvalidRefreshTokenError();

  const { userId, id: sessionId } = rotated;
  await revokeAccessToken(sessionId); // revoke the previous access token before issuing a new one

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

  return { accessToken, refreshToken: replacement.token };
}

/**
 * Ends a session whose refresh token was presented after it had been spent.
 *
 * The row was already fetched by id, so the spent hash is right there — no second
 * query and no index over previous hashes.
 *
 * Only acts on a match against previousTokenHash. Any other mismatched secret is
 * an ordinary bad token: it was never ours, and revoking a live session on the
 * strength of a wrong guess would hand anyone a way to sign a device out.
 */
async function revokeOnReuse(
  session: Session,
  presentedHash: string,
): Promise<void> {
  if (
    session.previousTokenHash === null ||
    presentedHash !== session.previousTokenHash
  ) {
    return;
  }

  await revokeAccessToken(session.id);
  await deleteSession(session.id, session.userId);
  await disconnectSocketConnection(session.userId, session.id).catch(() => {});

  logger.warn(
    {
      sessionId: session.id,
      userId: session.userId,
      deviceLabel: session.deviceLabel,
      ipAddress: session.ipAddress,
      lastUsedAt: session.lastUsedAt,
    },
    "refresh token reuse: a token already spent by rotation was presented again",
  );
}
