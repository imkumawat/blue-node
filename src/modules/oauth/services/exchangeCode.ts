import {
  constantTimeEqual,
  sha256Base64Url,
} from "../../../shared/utils/crypto.js";
import logger from "../../../utils/logger.js";
import { issueGrantTokens } from "../../auth/index.js";
import { consumeAuthorizationCode } from "../infra/oauthTokenStore.js";
import { touchClientLastUsed } from "../infra/clientQueries.js";
import { touchGrantLastUsed } from "../infra/grantQueries.js";
import { TokenRequestError } from "../errors.js";

export interface TokenResponse {
  access_token: string;
  token_type: "Bearer";
  expires_in: number;
  refresh_token: string;
  scope: string;
}

export interface ExchangeCodeParams {
  code: string;
  codeVerifier: string;
  clientId: string;
  redirectUri: string;
  resource?: string;
}

/**
 * Every rejection below returns the SAME message.
 *
 * Someone holding a stolen code learns nothing about which binding failed —
 * telling them "PKCE mismatch" rather than "wrong redirect_uri" hands them a
 * checklist. The actual reason goes to the log, where it is useful to us and
 * invisible to them.
 */
function reject(reason: string, context: Record<string, unknown>): never {
  logger.warn({ ...context, reason }, "OAuth code exchange rejected");
  throw new TokenRequestError(
    "invalid_grant",
    "Authorization code is invalid, expired, or already used",
  );
}

export async function exchangeCode(
  params: ExchangeCodeParams,
): Promise<TokenResponse> {
  // Atomic consume: if two requests race, exactly one gets the record and the
  // other sees nothing. Single use is enforced here, not by a later check.
  const record = await consumeAuthorizationCode(params.code);
  if (!record) {
    reject("code not found, expired, or already redeemed", {
      clientId: params.clientId,
    });
  }

  if (record.clientId !== params.clientId) {
    reject("code was issued to a different client", {
      expected: record.clientId,
      got: params.clientId,
    });
  }

  // Re-checked even though /authorize already validated it: the code is bound to
  // the exact URI it was issued for, so a code intercepted and replayed against
  // a different registered URI of the same client still fails.
  if (record.redirectUri !== params.redirectUri) {
    reject("redirect_uri does not match the authorization request", {
      clientId: params.clientId,
    });
  }

  if (params.resource !== undefined && params.resource !== record.resource) {
    reject("resource does not match the authorization request", {
      clientId: params.clientId,
    });
  }

  // PKCE (RFC 7636, S256). The challenge was fixed before the browser redirect,
  // so only whoever generated the verifier can redeem the code — which is what
  // makes an intercepted code useless against a public client.
  const derived = sha256Base64Url(params.codeVerifier);
  if (!constantTimeEqual(derived, record.codeChallenge)) {
    reject("PKCE verifier does not match the stored challenge", {
      clientId: params.clientId,
    });
  }

  const tokens = await issueGrantTokens({
    userId: record.userId,
    grantId: record.grantId,
    scopes: record.scopes,
    audience: record.resource,
  });

  // Best-effort. These drive a "last used" column and the unused-client prune —
  // neither is worth failing an exchange the user already completed.
  void Promise.all([
    touchGrantLastUsed(record.grantId),
    touchClientLastUsed(record.clientId),
  ]).catch((err: unknown) =>
    logger.warn({ err }, "failed to update OAuth usage markers"),
  );

  return {
    access_token: tokens.accessToken,
    token_type: "Bearer",
    expires_in: tokens.expiresInSec,
    refresh_token: tokens.refreshToken,
    scope: record.scopes.join(" "),
  };
}
