import { getRedis } from "../../../lib/cache/redis/client.js";
import { getEnvConfig } from "../../../config/env.js";
import { randomToken, sha256 } from "../../../shared/utils/crypto.js";

import type { Scope } from "../../../shared/constants/scopes.js";
import type { AuthSession } from "../../auth/types.js";
import type { OauthClient } from "../../../models/postgres/oauth/oauthClient.js";
import type { ValidatedAuthorizeRequest } from "../services/authorizeRequest.js";

interface PendingAuthorizationRequest extends ValidatedAuthorizeRequest {
  authSession: AuthSession | null;
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
