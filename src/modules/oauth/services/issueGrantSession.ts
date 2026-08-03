import { getEnvConfig } from "../../../config/env.js";
import { insertGrantSession } from "../infra/oauthGrantSessionQueries.js";
import {
  mintRefreshToken,
  signGrantAccessToken,
} from "../infra/oauthTokens.js";

export interface GrantCredentials {
  accessToken: string;
  refreshToken: string;
  expiresInSec: number;
}

export interface IssueGrantSessionParams {
  userId: string;
  clientId: string;
  grantId: string;
  scopes: string[];
  /** RFC 8707 resource indicator — becomes the access token's `aud`. */
  audience: string;
}

/**
 * Opens a new connection under a grant and credentials it.
 *
 * The sibling of createSession: that one credentials a device, this one
 * credentials an app's authorization. Called after a code exchange, never from a
 * route directly.
 *
 * The two credentials are deliberately different formats. The access token is a
 * JWT because a resource server verifies it from our JWKS without reaching our
 * datastore — the one thing a JWT actually buys. The refresh token is opaque
 * because it only ever comes back to our own /token endpoint, where the row has
 * to be read anyway to rotate it.
 *
 * Order matters: the row is written LAST. A failure before the insert leaves two
 * unusable strings and no state; the reverse — a row with no client holding its
 * token — would sit there until the sweep, occupying a connection slot in a
 * connected-apps list for an app that never got credentials.
 */
export async function issueGrantSession(
  params: IssueGrantSessionParams,
): Promise<GrantCredentials> {
  const { oauth } = getEnvConfig();

  // The id lives inside the refresh token, so it is generated here and reused as
  // the row's primary key — the token and the row cannot drift apart.
  const refresh = mintRefreshToken();

  const access = await signGrantAccessToken({
    userId: params.userId,
    clientId: params.clientId,
    grantId: params.grantId,
    scopes: params.scopes,
    audience: params.audience,
  });

  const now = Date.now();

  await insertGrantSession({
    id: refresh.grantSessionId,
    grantId: params.grantId,
    tokenHash: refresh.tokenHash,
    expiresAt: new Date(now + oauth.refreshTokenTtlSec * 1000),
    // Fixed here and never moved again. The sliding expiry above is pushed
    // forward on every refresh; this is the ceiling it can never pass.
    absoluteExpiresAt: new Date(now + oauth.refreshTokenAbsoluteTtlSec * 1000),
    // Recorded so the next rotation knows which access token it is retiring.
    accessTokenJti: access.jti,
    accessTokenExp: access.expiresAt,
  });

  return {
    accessToken: access.token,
    refreshToken: refresh.token,
    expiresInSec: oauth.accessTokenTtlSec,
  };
}
