import {
  blacklistAccessToken,
  rotateRefreshToken,
} from "../lib/tokenService.js";
import { InvalidRefreshTokenError } from "../errors.js";

/**
 * Spends an OAuth grant's refresh token and reports who it belonged to.
 *
 * The rotation itself — the atomic soft-rotate that makes a second presentation
 * of the same jti trip a family revoke — is the existing first-party machinery,
 * reused rather than reimplemented. That reuse is the whole reason token
 * mechanics stayed in one module: a second copy of reuse detection is a second
 * chance to get it subtly wrong.
 *
 * Rotation happens BEFORE the caller validates the grant, so a request that
 * fails those checks has still spent the token. That is deliberate: reaching
 * them means either a client presenting another client's token or an attempt to
 * widen scope, and burning the credential is the right answer to both.
 *
 * Returns only identity. The new tokens are minted by issueGrantTokens once the
 * caller has decided which scopes still apply — that is OAuth policy, not
 * something this layer should guess.
 */
export async function consumeGrantRefreshToken({
  refreshToken,
  audience,
}: {
  refreshToken: string;
  audience: string;
}): Promise<{ userId: string; grantId: string }> {
  const { rotated } = await rotateRefreshToken(refreshToken, audience);

  // A first-party browser session must never be redeemable at the OAuth token
  // endpoint. The audience check above already separates them, since a portal
  // token is minted for a different audience entirely; this is the explicit
  // statement of the same invariant, so the guarantee does not rest on a reader
  // noticing which audience was passed in.
  if (!rotated.grantId) {
    throw new InvalidRefreshTokenError();
  }

  // Retire the access token this refresh token was paired with, so rotating does
  // not leave a still-valid older credential in circulation. Skipped when it has
  // already expired — Redis rejects a non-positive TTL, and there is nothing
  // left to revoke.
  const remainingMs = rotated.accessExp.getTime() - Date.now();
  if (remainingMs > 0) {
    await blacklistAccessToken(
      rotated.accessJti,
      Math.ceil(remainingMs / 1000),
    );
  }

  return { userId: rotated.userId, grantId: rotated.grantId };
}
