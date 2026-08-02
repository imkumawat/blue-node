import logger from "../../../utils/logger.js";
import { getEnvConfig } from "../../../config/env.js";
import {
  consumeGrantRefreshToken,
  issueGrantTokens,
} from "../../auth/index.js";
import { findGrantById, touchGrantLastUsed } from "../infra/grantQueries.js";
import { touchClientLastUsed } from "../infra/clientQueries.js";
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
 * As in exchangeCode: one message out, the real reason to the log. A caller
 * holding someone else's refresh token learns nothing about which check failed.
 */
function reject(reason: string, context: Record<string, unknown>): never {
  logger.warn({ ...context, reason }, "OAuth refresh rejected");
  throw new TokenRequestError(
    "invalid_grant",
    "Refresh token is invalid, expired, or has been revoked",
  );
}

export async function refreshGrantTokens(
  params: RefreshGrantParams,
): Promise<TokenResponse> {
  const { mcp } = getEnvConfig();
  if (!mcp.resourceUri) {
    throw new Error("MCP_RESOURCE_URI must be set to refresh OAuth tokens");
  }

  const audience = mcp.resourceUri;
  if (params.resource !== undefined && params.resource !== audience) {
    reject("resource does not match the token audience", {
      clientId: params.clientId,
    });
  }

  // Rotates and blacklists the paired access token. Throws on reuse (which also
  // revokes the family) or on a first-party token presented here.
  //
  // The auth layer speaks this codebase's error vocabulary — INVALID_TOKEN,
  // TOKEN_EXPIRED, REFRESH_TOKEN_INVALID. A token endpoint has to answer in the
  // RFC's instead, or a client parsing the spec shape cannot interpret the
  // failure at all. Every one of those cases means the same thing to a client
  // anyway, so they collapse into invalid_grant with the real cause logged.
  const { userId, grantId } = await consumeGrantRefreshToken({
    refreshToken: params.refreshToken,
    audience,
  }).catch((err: unknown) =>
    reject("refresh token rejected during rotation", {
      clientId: params.clientId,
      cause: err instanceof Error ? err.message : String(err),
    }),
  );

  // The grant is the live record of consent. If the user removed this app the row
  // is gone, and the cascade already deleted the refresh token — so in practice
  // rotation above would have failed first. This is the belt to that braces.
  const grant = await findGrantById(grantId);
  if (!grant) {
    reject("grant no longer exists", { clientId: params.clientId, grantId });
  }

  if (grant.clientId !== params.clientId) {
    reject("refresh token belongs to a different client", {
      expected: grant.clientId,
      got: params.clientId,
    });
  }

  if (grant.userId !== userId) {
    reject("token subject does not match the grant", { grantId });
  }

  // A refresh may narrow scope but never widen it: the ceiling is what the user
  // actually consented to, and it is re-read from the grant on every refresh
  // rather than carried along in the token. So a scope revoked in the meantime
  // stops being issued from the next refresh onward.
  let scopes = grant.scopes;
  if (params.requestedScope !== undefined) {
    const requested = params.requestedScope.split(" ").filter(Boolean);
    const covered = new Set(grant.scopes);
    const extra = requested.filter((s) => !covered.has(s));

    if (extra.length > 0) {
      logger.warn(
        { clientId: params.clientId, grantId, extra },
        "OAuth refresh requested scopes beyond the grant",
      );
      throw new TokenRequestError(
        "invalid_scope",
        "Requested scope exceeds what was granted",
      );
    }
    scopes = requested;
  }

  const tokens = await issueGrantTokens({
    userId,
    grantId,
    scopes,
    audience,
  });

  void Promise.all([
    touchGrantLastUsed(grantId),
    touchClientLastUsed(grant.clientId),
  ]).catch((err: unknown) =>
    logger.warn({ err }, "failed to update OAuth usage markers"),
  );

  return {
    access_token: tokens.accessToken,
    token_type: "Bearer",
    expires_in: tokens.expiresInSec,
    refresh_token: tokens.refreshToken,
    scope: scopes.join(" "),
  };
}
