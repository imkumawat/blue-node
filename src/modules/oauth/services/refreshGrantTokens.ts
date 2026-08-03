import logger from "../../../utils/logger.js";
import { getEnvConfig } from "../../../config/env.js";
import { touchClientLastUsed } from "../infra/clientQueries.js";
import { findGrantById, touchGrantLastUsed } from "../infra/grantQueries.js";
import {
  deleteGrantSessionsByGrant,
  findGrantSessionById,
  rotateGrantSession,
} from "../infra/oauthGrantSessionQueries.js";
import { denyAccessToken, denyGrant } from "../infra/oauthTokenStore.js";
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
 * Ordering here is deliberate. The token is CLASSIFIED before the client is
 * checked, because a spent token being presented means it leaked, and that is
 * true whoever presents it. Everything else is checked before anything is
 * written.
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
    // A match on the PREVIOUS hash is not an ordinary failure. That token was
    // ours and was already spent by a rotation, so either it leaked or the client
    // is replaying — and unlike a browser with two tabs racing, an OAuth client
    // keeps one token store and refreshes once. Treat it as a compromise: cut
    // every connection under the grant and deny the access tokens already out.
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

      await denyGrant(session.grantId);
      await deleteGrantSessionsByGrant(session.grantId);
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
