import { getEnvConfig } from "../../../config/env.js";
import { getDeviceLabel } from "../../../utils/getDeviceLabel.js";
import { hmacSha256, randomToken } from "../../../shared/utils/crypto.js";
import { getScopes } from "../lib/permissionQueries.js";
import { issueAccessToken } from "../lib/tokenStore.js";
import { insertSession } from "../lib/sessionQueries.js";

/**
 * Device-session credentials.
 *
 * The sibling of issueGrantTokens: that one credentials an OAuth grant, this one
 * credentials a device. Both wrap lib/tokenStore and are called by other code
 * rather than by a route.
 *
 * Both tokens here are opaque. Nothing on this path is a JWT: the only party that
 * ever verifies these is this process, which is already making a Redis round trip,
 * so a signature would buy nothing a lookup does not — and it would cost the
 * ability to revoke by deleting.
 */

/**
 * Just the two tokens — the only things that leave this layer.
 *
 * No session id: it is already inside the access token, so returning it would be
 * a second copy of the same fact. No scopes: the caller computed them and passed
 * them in. No expiries: cookie lifetimes come from config, and nothing reads a
 * token's expiry from here.
 */
export interface SessionCredentials {
  accessToken: string;
  refreshToken: string;
}

export interface CreateSessionParams {
  userId: string;
  userAgent: string | null;
  ipAddress: string | null;
}

/**
 * Opens a new device session — the login and email-verification path.
 *
 * The session row is written FIRST because the access token embeds its id. This
 * is not a transaction and does not need to be: a failure after the insert leaves
 * an unreachable session row, which the expiry sweep collects. That is the
 * harmless direction to fail in — the reverse, a live token pointing at no
 * session, would only fail closed by accident.
 *
 * The session tracks the REFRESH lifetime, not the access one: it is how long the
 * device may stay signed in, not how long one credential lives.
 */
export async function createSession(
  params: CreateSessionParams,
): Promise<SessionCredentials> {
  const { accessExpiry, refreshExpiry, refreshPrefix, pepper } =
    getEnvConfig().tokens;
  const refreshToken = `${refreshPrefix}${randomToken(32)}`;

  // Read fresh rather than carrying the old token's scopes forward, so a
  // permission revoked in the meantime stops being issued from this refresh on.
  const scopes = await getScopes(params.userId);

  const session = await insertSession({
    userId: params.userId,
    tokenHash: hmacSha256(pepper, refreshToken),
    deviceLabel: getDeviceLabel(params.userAgent),
    userAgent: params.userAgent,
    ipAddress: params.ipAddress,
    expiresAt: new Date(Date.now() + refreshExpiry * 1000),
  });

  const accessExpiresAtSec = Math.floor(
    new Date(Date.now() + accessExpiry * 1000).getTime() / 1000,
  );

  const accessToken = await issueAccessToken({
    userId: params.userId,
    sessionId: session.id,
    scopes: scopes,
    exp: accessExpiresAtSec,
  });

  return { accessToken, refreshToken };
}
