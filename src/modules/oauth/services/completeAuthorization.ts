import { upsertGrant } from "../infra/grantQueries.js";
import { issueAuthCode } from "../infra/authCodeStore.js";
import type { Scope } from "../../../shared/constants/scopes.js";

export async function completeAuthorization(params: {
  userId: string;
  clientId: string;
  redirectUri: string;

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
