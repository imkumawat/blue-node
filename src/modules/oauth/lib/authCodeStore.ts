import { getRedis } from "../../../lib/cache/redis/client.js";
import { getEnvConfig } from "../../../config/env.js";
import { randomToken, sha256 } from "../../../shared/utils/crypto.js";

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

export async function issueAuthCode(record: AuthCodeRecord): Promise<string> {
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

export async function consumeAuthCode(
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
