import logger from "../../../utils/logger.js";
import { getEnvConfig } from "../../../config/env.js";
import { touchClientLastUsed } from "../infra/clientQueries.js";
import { findGrantById, touchGrantLastUsed } from "../infra/grantQueries.js";
import {
  findGrantSessionById,
  rotateGrantSession,
} from "../infra/oauthGrantSessionQueries.js";
import { denyAccessToken } from "../infra/oauthTokenStore.js";
import {
  hashRefreshToken,
  mintRotatedRefreshToken,
  parseRefreshToken,
  signGrantAccessToken,
} from "../infra/oauthTokens.js";
import { TokenRequestError } from "../errors.js";
import type { TokenResponse } from "./exchangeCode.js";

export interface RefreshGrantParams {
  refreshToken: string;
  clientId: string;
  /** Optional narrowing. Absent means "everything the grant still covers". */
  requestedScope?: string;
  resource?: string;
}

/**
 * One message out, the real reason to the log. A caller holding someone else's
 * refresh token learns nothing about which check failed — and notably, a REUSED
 * token gets the same answer as an expired one, so the response never reveals
 * that a token was once valid.
 */
function reject(reason: string, context: Record<string, unknown>): never {
  logger.warn({ ...context, reason }, "OAuth refresh rejected");
  throw new TokenRequestError(
    "invalid_grant",
    "Refresh token is invalid, expired, or has been revoked",
  );
}

/**
 * Rotates a connection's credentials.
 *
 * The refresh token carries the connection's id, so redeeming one starts as a
 * primary-key read — and that single read is enough to say whether the presented
 * secret is the live one, the one already spent, or neither. Keying by a hash of
 * the whole token would need a second query against a second index to answer the
 * middle case.
 *
 * Nothing is written until every check has passed. The one exception is the
 * denial of the retiring access token, which happens after the rotation has
 * committed — deny it earlier and a rotation that then fails would have killed a
 * credential the client is still legitimately using.
 */
export async function refreshGrantTokens(
  params: RefreshGrantParams,
): Promise<TokenResponse> {
  const { mcp, oauth } = getEnvConfig();

  const audience = mcp.resourceUri;
  if (params.resource !== undefined && params.resource !== audience) {
    reject("resource does not match the token audience", {
      clientId: params.clientId,
    });
  }

  // A first-party refresh token cannot be redeemed here: it carries a different
  // prefix, so this fails to parse rather than failing to be found.
  const parsed = parseRefreshToken(params.refreshToken);
  if (!parsed) {
    reject("refresh token is not a grant refresh token", {
      clientId: params.clientId,
    });
  }

  const session = await findGrantSessionById(parsed.grantSessionId);
  if (!session) {
    reject("no connection for this refresh token", {
      clientId: params.clientId,
    });
  }

  const presentedHash = hashRefreshToken(params.refreshToken);

  if (presentedHash !== session.tokenHash) {
    // A match on the PREVIOUS hash means this token was ours and a rotation has
    // already spent it. Recorded, not acted on — and the reasoning is worth
    // keeping, because the obvious response is the wrong one.
    //
    // The overwhelmingly likely cause is a RETRY: the rotation committed, the
    // response was lost, and the client re-sent the same token. Its first attempt
    // succeeded, so it is already holding the new pair — letting this one fail
    // costs nothing. But revoking here would deny the access token issued
    // milliseconds ago and delete the row holding the brand-new refresh token, so
    // one lost response would take a healthy connector down completely.
    //
    // Theft is the other explanation, and it is the weaker one: these tokens live
    // in the client's own server-side store, never in a browser or on a device.
    // Reaching them means compromising the client's infrastructure.
    //
    // Note this is the OPPOSITE call to the first-party path, which does end the
    // session. There the client is ours, so single-flight refresh can be
    // guaranteed and a benign race ruled out. A third-party client's retry
    // behaviour is not ours to control — less control, less aggressive response.
    if (
      session.previousTokenHash !== null &&
      presentedHash === session.previousTokenHash
    ) {
      logger.warn(
        {
          clientId: params.clientId,
          grantId: session.grantId,
          grantSessionId: session.id,
        },
        "OAuth refresh token reuse: a token already spent by rotation was presented again",
      );
    }

    reject("refresh token secret does not match", {
      clientId: params.clientId,
      grantSessionId: session.id,
    });
  }

  // The grant is the live record of consent, and the only source of identity
  // here: the refresh token carries no user id, so there is nothing to
  // cross-check and nothing that can disagree.
  const grant = await findGrantById(session.grantId);
  if (!grant) {
    reject("grant no longer exists", {
      clientId: params.clientId,
      grantId: session.grantId,
    });
  }

  // RFC 6749 §6: the token must have been issued to the authenticating client.
  if (grant.clientId !== params.clientId) {
    reject("refresh token belongs to a different client", {
      expected: grant.clientId,
      got: params.clientId,
    });
  }

  // A refresh may narrow scope but never widen it. The ceiling is what the user
  // actually consented to, re-read from the grant on every refresh rather than
  // carried along in the token — so a scope revoked in the meantime stops being
  // issued from the next refresh onward.
  const scopes = narrowScopes(params, grant.scopes, session.grantId);

  const access = await signGrantAccessToken({
    userId: grant.userId,
    clientId: grant.clientId,
    grantId: grant.id,
    scopes,
    audience,
  });

  const replacement = mintRotatedRefreshToken(session.id);

  // The atomic claim. Everything above was read-then-decide; this is the one
  // statement that can lose. Concurrent presenters of the same token serialise
  // here and only the first matches, so the checks above cannot be raced past.
  const rotated = await rotateGrantSession({
    id: session.id,
    presentedHash,
    nextTokenHash: replacement.tokenHash,
    slidingExpiresAt: new Date(Date.now() + oauth.refreshTokenTtlSec * 1000),
    accessTokenJti: access.jti,
    accessTokenExp: access.expiresAt,
  });

  if (!rotated) {
    reject("lost the rotation claim, or the connection expired", {
      clientId: params.clientId,
      grantSessionId: session.id,
    });
  }

  // Retire the pair, not just the token. The client has swapped its refresh
  // token, so the access token handed over alongside it should stop working too —
  // otherwise a copy of it keeps answering for the rest of its lifetime.
  if (session.accessTokenJti && session.accessTokenExp) {
    await denyAccessToken(session.accessTokenJti, session.accessTokenExp);
  }

  // Best-effort: these drive a "last used" column and the unused-client prune,
  // neither worth failing a refresh the client already completed.
  void Promise.all([
    touchGrantLastUsed(grant.id),
    touchClientLastUsed(grant.clientId),
  ]).catch((err: unknown) =>
    logger.warn({ err }, "failed to update OAuth usage markers"),
  );

  return {
    access_token: access.token,
    token_type: "Bearer",
    expires_in: oauth.accessTokenTtlSec,
    refresh_token: replacement.token,
    scope: scopes.join(" "),
  };
}

function narrowScopes(
  params: RefreshGrantParams,
  granted: string[],
  grantId: string,
): string[] {
  if (params.requestedScope === undefined) return granted;

  const requested = params.requestedScope.split(" ").filter(Boolean);
  const covered = new Set(granted);
  const extra = requested.filter((scope) => !covered.has(scope));

  if (extra.length > 0) {
    logger.warn(
      { clientId: params.clientId, grantId, extra },
      "OAuth refresh requested scopes beyond the grant",
    );
    // NOT invalid_grant: the token is fine, the request is not. A client that
    // cannot tell those apart will retry the refresh forever instead of asking
    // for less.
    throw new TokenRequestError(
      "invalid_scope",
      "Requested scope exceeds what was granted",
    );
  }

  return requested;
}
