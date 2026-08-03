import { getRedis } from "../../../lib/cache/redis/client.js";
import { getEnvConfig } from "../../../config/env.js";
import { randomToken, sha256 } from "../../../shared/utils/crypto.js";

import type { AuthSession } from "../../auth/types.js";
import type { ValidatedAuthorizeRequest } from "../services/authorizeRequest.js";

interface PendingAuthorizationRequest extends ValidatedAuthorizeRequest {
  authSession: AuthSession | null;
}

export interface AuthCodeRecord {
  userId: string;
  clientId: string;
  grantId: string;
  redirectUri: string;
  scopes: string[];
  codeChallenge: string;
  // S256 only. OAuth 2.1 requires it for public clients and the authorization
  // server metadata advertises exactly this, so "plain" is never accepted.
  codeChallengeMethod: "S256";
  resource: string;
}

function oauthPendingKeyFor(ticket: string): string {
  const { redis } = getEnvConfig();
  return `${redis.keys.oauthPending}${sha256(ticket)}`;
}

export async function createPendingAuthorizationRequest(
  oAuthRequest: PendingAuthorizationRequest,
): Promise<string> {
  const { oauth } = getEnvConfig();
  const ticket = randomToken(32);

  await getRedis().set(
    oauthPendingKeyFor(ticket),
    JSON.stringify(oAuthRequest),
    "EX",
    oauth.pendingAuthTtlSec,
  );

  return ticket;
}

function parsePendingAuthorizationRequest(
  raw: string | null,
): PendingAuthorizationRequest | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as PendingAuthorizationRequest;
  } catch {
    // Our own value, so a parse failure is corruption rather than an attack.
    return null;
  }
}

export async function readPendingAuthorizationRequest(
  ticket: string,
): Promise<PendingAuthorizationRequest | null> {
  return parsePendingAuthorizationRequest(
    await getRedis().get(oauthPendingKeyFor(ticket)),
  );
}

export async function updatePendingAuthorizationRequest(
  ticket: string,
  updatedOAuthRequest: PendingAuthorizationRequest,
): Promise<void> {
  const pendingOAuthRequest = await readPendingAuthorizationRequest(ticket);
  if (pendingOAuthRequest) {
    await getRedis().set(
      oauthPendingKeyFor(ticket),
      JSON.stringify(updatedOAuthRequest),
      "KEEPTTL",
    );
  }
  return;
}

export async function consumePendingAuthorizationRequest(
  ticket: string,
): Promise<PendingAuthorizationRequest | null> {
  return parsePendingAuthorizationRequest(
    await getRedis().getdel(oauthPendingKeyFor(ticket)),
  );
}

export async function issueAuthorizationCode(
  record: AuthCodeRecord,
): Promise<string> {
  const { oauth, redis } = getEnvConfig();
  const code = randomToken(32);

  await getRedis().set(
    `${redis.keys.oauthCode}${sha256(code)}`,
    JSON.stringify(record),
    "EX",
    oauth.authCodeTtlSec,
  );

  return code;
}

export async function consumeAuthorizationCode(
  code: string,
): Promise<AuthCodeRecord | null> {
  const { redis } = getEnvConfig();
  const raw = await getRedis().getdel(`${redis.keys.oauthCode}${sha256(code)}`);
  if (!raw) return null;

  try {
    return JSON.parse(raw) as AuthCodeRecord;
  } catch {
    return null;
  }
}
