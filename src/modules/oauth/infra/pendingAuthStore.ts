import { getRedis } from "../../../lib/cache/redis/client.js";
import { getEnvConfig } from "../../../config/env.js";
import { randomToken, sha256 } from "../../../shared/utils/crypto.js";
import type { Scope } from "../../../shared/constants/scopes.js";
import type { AuthSession } from "../../auth/types.js";
import type { OauthClient } from "../../../models/postgres/oauth/oauthClient.js";

export interface PendingAuthorization {
  client: OauthClient;
  response_type: string;
  redirectUri: string;
  scopes: Scope[];
  codeChallenge: string;
  codeChallengeMethod: "S256";
  resource: string;
  state: string | null;
  authSession: AuthSession | null;
}

function key(ticket: string): string {
  const { redis } = getEnvConfig();
  return `${redis.keys.oauthPending}${sha256(ticket)}`;
}

function parse(raw: string | null): PendingAuthorization | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as PendingAuthorization;
  } catch {
    // Our own value, so a parse failure is corruption rather than an attack.
    return null;
  }
}

export async function createPending(pending: string): Promise<string> {
  const { oauth } = getEnvConfig();
  const ticket = randomToken(32);

  await getRedis().set(
    key(ticket),
    JSON.stringify(pending),
    "EX",
    oauth.pendingAuthTtlSec,
  );

  return ticket;
}

export async function readPending(
  ticket: string,
): Promise<PendingAuthorization | null> {
  return parse(await getRedis().get(key(ticket)));
}

export async function attachUser(
  ticket: string,
  updated: string,
): Promise<void> {
  const pending = await readPending(ticket);
  if (pending) {
    await getRedis().set(key(ticket), updated, "KEEPTTL");
  }
  return;
}

export async function consumePending(
  ticket: string,
): Promise<PendingAuthorization | null> {
  return parse(await getRedis().getdel(key(ticket)));
}
