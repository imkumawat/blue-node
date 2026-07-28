import { upsertGrant } from "../lib/grantQueries.js";
import { issueAuthCode } from "../lib/authCodeStore.js";
import type { Scope } from "../../../shared/constants/scopes.js";

/**
 * Runs when the user approves — or when an existing grant already covered the
 * request and the consent screen was skipped. Records the consent, then issues
 * the code that carries it to the token endpoint.
 *
 * Takes flat parameters rather than a ValidatedAuthorizeRequest so the caller can
 * pass a pending-authorization record straight through: that record deliberately
 * stores only the fields needed here, not the whole client row.
 */
export async function completeAuthorization(params: {
  userId: string;
  clientId: string;
  redirectUri: string;
  /**
   * THIS request's scopes, not the grant's full set. A grant may cover more from
   * an earlier approval; a token must carry only what was asked for now.
   */
  scopes: Scope[];
  codeChallenge: string;
  codeChallengeMethod: "S256";
  resource: string;
}): Promise<string> {
  const grant = await upsertGrant(
    params.userId,
    params.clientId,
    params.scopes,
  );

  return issueAuthCode({
    userId: params.userId,
    clientId: params.clientId,
    grantId: grant.id,
    redirectUri: params.redirectUri,
    scopes: params.scopes,
    codeChallenge: params.codeChallenge,
    codeChallengeMethod: params.codeChallengeMethod,
    resource: params.resource,
  });
}
