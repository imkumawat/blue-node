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
  CaptchaRequiredError,
} from "../errors.js";
import { assessLoginRisk } from "./assessLoginRisk.js";
import { verifyCaptcha } from "../../../lib/captcha/index.js";
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
  captchaToken?: string;
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
    // failure counters (counting window)
    emailCount: `${authFail}${e}`,
    ipCount: `${authFailIp}${ip}`,
    pairCount: `${authFailPair}${e}|${ip}`,
    // fixed-duration locks (separate from counters — see assertAccNotLocked)
    ipLock: `lock:ip:${ip}`,
    pairLock: `lock:pair:${e}|${ip}`,
  };
}

// Atomic INCR + EXPIRE-on-first in one Lua op — no TTL-leak: a separate incr
// then expire could crash in between, leaving a counter with no TTL (permanent).
// EXPIRE only on first incr → the COUNTING window is fixed from the first
// failure; the LOCKOUT duration is handled separately by the lock keys below.
const INCR_WITH_TTL = `
  local c = redis.call('INCR', KEYS[1])
  if c == 1 then redis.call('EXPIRE', KEYS[1], ARGV[1]) end
  return c
`;

// Lock checks read the LOCK keys (fixed duration set at the moment of locking),
// NOT the counters — so the lockout lasts a consistent lockoutWindowSec no matter
// when within the counting window the threshold was hit.
async function assertAccNotLocked(
  email: string,
  ip: string,
  captchaToken?: string,
): Promise<void> {
  const k = keysFor(email, ip);
  const res = await getRedis().pipeline().ttl(k.ipLock).ttl(k.pairLock).exec();
  const ipLockTtl = (res?.[0]?.[1] as number) ?? -2;
  const pairLockTtl = (res?.[1]?.[1] as number) ?? -2;

  if (ipLockTtl > 0) throw new AccountLockedError(ipLockTtl);
  if (pairLockTtl > 0) throw new AccountLockedError(pairLockTtl);

  // CAPTCHA gate — client-risk based (assessLoginRisk is keyed on IP, not the
  // account) and inert when the feature is disabled. Runs after the hard locks
  // so a bot is challenged BEFORE the expensive bcrypt. DoS-safe: a legit user
  // from a clean IP is never challenged.
  const { captchaRequired } = await assessLoginRisk(ip);
  if (captchaRequired) {
    const ok = captchaToken ? await verifyCaptcha(captchaToken, ip) : false;
    if (!ok) throw new CaptchaRequiredError();
  }
}

async function recordFailedAttempt(email: string, ip: string): Promise<void> {
  const { lockoutWindowSec, maxFailedLogins, emailSoftWarnThreshold } =
    getEnvConfig().auth;
  const k = keysFor(email, ip);
  const redis = getRedis();

  const [emailCount, ipCount, pairCount] = (await Promise.all([
    redis.eval(INCR_WITH_TTL, 1, k.emailCount, lockoutWindowSec),
    redis.eval(INCR_WITH_TTL, 1, k.ipCount, lockoutWindowSec),
    redis.eval(INCR_WITH_TTL, 1, k.pairCount, lockoutWindowSec),
  ])) as [number, number, number];

  // Threshold hit → set a FIXED-duration lock (NX so repeated failures don't
  // extend it; the lock lasts exactly lockoutWindowSec from THIS moment).
  if (ipCount >= maxFailedLogins) {
    await redis.set(k.ipLock, "1", "EX", lockoutWindowSec, "NX");
  }
  if (pairCount >= maxFailedLogins) {
    await redis.set(k.pairLock, "1", "EX", lockoutWindowSec, "NX");
  }

  if (emailCount >= emailSoftWarnThreshold) {
    logger.warn(
      { emailHash: sha256(email.toLowerCase()), ip, emailCount },
      "Suspicious login activity — coordinated email-wide failures",
    );
  }
}

async function clearFailedAttempts(email: string, ip: string): Promise<void> {
  // Clear the ip/pair counters AND locks on success; leave the per-email
  // surveillance counter — a single success doesn't prove absence of a
  // distributed attack across other IPs.
  const k = keysFor(email, ip);
  await getRedis().del(k.ipCount, k.pairCount, k.ipLock, k.pairLock);
}

export async function loginWithPassword({
  email,
  password,
  ipAddress,
  captchaToken,
}: LoginInput): Promise<LoginResult> {
  const { userAudience } = getEnvConfig().jwt;

  // 1. Pre-check lockout + CAPTCHA gate BEFORE expensive bcrypt — fail fast
  await assertAccNotLocked(email, ipAddress, captchaToken);

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
