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

/* ────────────────────────────────────────────────────────────────────────────
   Denying access tokens that are still inside their lifetime

   Access tokens are stateless, so the only way to stop one early is to remember
   that it should be refused. Two things can make that true, at two different
   granularities, and each gets its own key rather than one shared shape:

     jti  ONE token was retired — the pair its refresh token belonged to has
          rotated, so the client has already moved on from it
     gid  the whole grant is gone — the user disconnected the app, and every
          token issued under it has to stop at once

   Both keys carry a TTL of at most one access-token lifetime. Past that no token
   they could deny is still verifiable, so the entries expire on their own and
   neither list grows with traffic.
   ──────────────────────────────────────────────────────────────────────────── */

/**
 * Refuses one access token for whatever is left of its life.
 *
 * TTL comes from the token's own exp rather than a fixed window: an entry that
 * outlives the token it denies is dead weight, and one that expires early would
 * quietly let the token work again.
 */
export async function denyAccessToken(
  jti: string,
  expiresAt: Date,
): Promise<void> {
  const { redis } = getEnvConfig();
  const ttlSec = Math.ceil((expiresAt.getTime() - Date.now()) / 1000);

  // Already expired — the token cannot verify anyway, and SET with a
  // non-positive EX is an error rather than a no-op.
  if (ttlSec <= 0) return;

  await getRedis().set(`${redis.keys.blacklist}${jti}`, "1", "EX", ttlSec);
}

/**
 * Refuses every access token issued under a grant.
 *
 * Deleting the grant already kills its refresh tokens through the FK cascade;
 * this is what closes the window on the access tokens already handed out.
 */
export async function denyGrant(grantId: string): Promise<void> {
  const { redis, oauth } = getEnvConfig();

  await getRedis().set(
    `${redis.keys.grantRevoked}${grantId}`,
    "1",
    "EX",
    oauth.accessTokenTtlSec,
  );
}

/**
 * Whether a verified access token is still usable.
 *
 * One round trip for both keys. Splitting this into two awaits would double the
 * latency of every authenticated MCP call for no benefit, and hiding the fact
 * that there are two keys is the point: the caller asks a question about a token,
 * not about Redis.
 */
export async function isAccessTokenDenied(
  jti: string,
  grantId: string,
): Promise<boolean> {
  const { redis } = getEnvConfig();

  const [tokenDenied, grantDenied] = await getRedis().mget(
    `${redis.keys.blacklist}${jti}`,
    `${redis.keys.grantRevoked}${grantId}`,
  );

  return tokenDenied !== null || grantDenied !== null;
}
