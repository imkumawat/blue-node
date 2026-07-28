import { getRedis } from "../../../lib/cache/redis/client.js";
import { getEnvConfig } from "../../../config/env.js";
import { randomToken, sha256 } from "../../../shared/utils/crypto.js";

/**
 * Everything the token endpoint needs to validate an exchange, captured at the
 * moment the user consented.
 *
 * All of it is re-checked at /token rather than trusted from that request: the
 * redirect_uri and resource must match what the code was issued for, and the
 * PKCE challenge must match the verifier presented. Storing them here is what
 * makes those checks possible.
 */
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

/**
 * Issues a one-time authorization code and returns the plaintext.
 *
 * Only the SHA-256 of the code is stored — the same treatment email-verification
 * and password-reset codes get, so a dump of Redis yields nothing replayable.
 */
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

/**
 * Reads and destroys a code in one atomic step.
 *
 * Single use is a hard requirement, not a nicety — a code redeemable twice is an
 * account takeover. GETDEL makes read-and-delete indivisible, so two concurrent
 * redemptions cannot both succeed the way a GET-then-DEL pair could. (Needs
 * Redis 6.2+.)
 *
 * Returns null for a code that never existed, expired, or was already redeemed.
 * The three are indistinguishable by design and all mean the same to the caller:
 * reject. NOTE: that also means replay is PREVENTED but not DETECTED — OAuth 2.1
 * additionally suggests revoking tokens already issued from a replayed code,
 * which would need a tombstone. Deliberately not built yet.
 */
export async function consumeAuthCode(
  code: string,
): Promise<AuthCodeRecord | null> {
  const { redis } = getEnvConfig();
  const raw = await getRedis().getdel(`${redis.keys.oauthCode}${sha256(code)}`);
  if (!raw) return null;

  try {
    return JSON.parse(raw) as AuthCodeRecord;
  } catch {
    // We wrote this value, so a parse failure is corruption, not an attack. The
    // code is already destroyed either way — reject rather than throw a 500.
    return null;
  }
}
