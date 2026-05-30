import { getEnvConfig } from "../../../config/env.js";
import { getRedis } from "../../../lib/cache/redis/client.js";
import logger from "../../../utils/logger.js";
import { sha256 } from "../../../shared/utils/crypto.js";
import { findUserByEmail } from "../lib/userQueries.js";
import { verifyPassword } from "../../../shared/utils/password.js";
import { getScopes } from "../lib/permissionQueries.js";
import {
  generateAccessToken,
  generateRefreshToken,
  storeRefreshToken,
} from "../lib/tokenService.js";
import type { IssuedToken } from "../lib/tokenService.js";
import {
  InvalidCredentialsError,
  AccountNotActiveError,
  AccountLockedError,
} from "../errors.js";
import type { User } from "../../../models/postgres/user/user.js";

// Pre-computed bcrypt hash (cost 12) — running a dummy compare when the user
// is not found ensures both "email not found" and "wrong password" paths take
// the same ~100ms, preventing timing-based user enumeration.
const DUMMY_HASH =
  "$2b$12$KIXuqpXqd1zHT8OTiJSybeNr0OBb8MkNLW4JmZv3q5I7k5ld.oy4e";

interface LoginInput {
  email: string;
  password: string;
  ipAddress: string;
}

interface LoginResult {
  user: User;
  access: IssuedToken;
  refresh: IssuedToken;
}

/**
 * Three independent counters defend against distinct threat models:
 *   - per-IP   → blocks single-source bruteforce
 *   - per-pair → blocks (email|ip) — same IP attacking same email
 *   - per-email → log-only surveillance; does NOT block, so an attacker
 *                 from many IPs cannot DoS the legitimate account owner
 */
function keysFor(email: string, ip: string) {
  const { authFail, authFailIp, authFailPair } = getEnvConfig().redis.keys;
  const e = email.toLowerCase();
  return {
    email: `${authFail}${e}`,
    ip: `${authFailIp}${ip}`,
    pair: `${authFailPair}${e}|${ip}`,
  };
}

async function assertNotLocked(email: string, ip: string): Promise<void> {
  const { maxFailedLogins } = getEnvConfig().auth;
  const k = keysFor(email, ip);
  const redis = getRedis();

  const [ipRaw, pairRaw] = await redis.mget(k.ip, k.pair);
  const ipCount = parseInt(ipRaw ?? "0", 10);
  const pairCount = parseInt(pairRaw ?? "0", 10);

  if (ipCount >= maxFailedLogins) {
    const ttl = await redis.ttl(k.ip);
    throw new AccountLockedError(ttl > 0 ? ttl : null);
  }
  if (pairCount >= maxFailedLogins) {
    const ttl = await redis.ttl(k.pair);
    throw new AccountLockedError(ttl > 0 ? ttl : null);
  }
}

async function recordFailedAttempt(email: string, ip: string): Promise<void> {
  const { lockoutWindowSec, emailSoftWarnThreshold } = getEnvConfig().auth;
  const k = keysFor(email, ip);
  const redis = getRedis();

  const results = await redis
    .pipeline()
    .incr(k.email)
    .incr(k.ip)
    .incr(k.pair)
    .exec();
  const [emailCount, ipCount, pairCount] = (results ?? []).map(
    ([, v]) => v as number,
  );

  if (emailCount === 1) await redis.expire(k.email, lockoutWindowSec);
  if (ipCount === 1) await redis.expire(k.ip, lockoutWindowSec);
  if (pairCount === 1) await redis.expire(k.pair, lockoutWindowSec);

  if (emailCount! >= emailSoftWarnThreshold) {
    logger.warn(
      { emailHash: sha256(email.toLowerCase()), ip, emailCount },
      "Suspicious login activity — coordinated email-wide failures",
    );
  }
}

async function clearFailedAttempts(email: string, ip: string): Promise<void> {
  // Leave the per-email surveillance counter alone — a single success doesn't
  // prove absence of a distributed attack across other IPs.
  const k = keysFor(email, ip);
  await getRedis().del(k.ip, k.pair);
}

export async function loginWithPassword({
  email,
  password,
  ipAddress,
}: LoginInput): Promise<LoginResult> {
  const { userAudience } = getEnvConfig().jwt;

  // 1. Pre-check lockout BEFORE expensive bcrypt — fail fast under attack
  await assertNotLocked(email, ipAddress);

  const user = await findUserByEmail(email);

  if (!user) {
    await verifyPassword(password, DUMMY_HASH); // timing protection
    await recordFailedAttempt(email, ipAddress); // counted even for unknown emails to prevent enumeration
    throw new InvalidCredentialsError();
  }

  const valid = await verifyPassword(password, user.passwordHash);
  if (!valid) {
    await recordFailedAttempt(email, ipAddress);
    throw new InvalidCredentialsError();
  }

  if (user.status !== "active") throw new AccountNotActiveError();

  // Success — clear the per-IP + per-pair counters so legitimate users with
  // typos aren't penalized. Email-wide counter is intentionally retained as a
  // surveillance signal.
  await clearFailedAttempts(email, ipAddress);

  const scopes = await getScopes(user.id);
  const access = generateAccessToken(user.id, scopes, userAudience);
  const refresh = generateRefreshToken(user.id, userAudience);
  await storeRefreshToken(
    user.id,
    refresh.jti,
    refresh.expiresAt,
    access.jti,
    access.expiresAt,
  );

  return { user, access, refresh };
}
