import { getEnvConfig } from "../../../config/env.js";
import { getRedis } from "../../../lib/cache/redis/client.js";
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
}

interface LoginResult {
  user: User;
  access: IssuedToken;
  refresh: IssuedToken;
}

function failKey(email: string): string {
  const { authFail } = getEnvConfig().redis.keys;
  return `${authFail}${email.toLowerCase()}`;
}

async function assertAccountNotLocked(email: string): Promise<void> {
  const { maxFailedLogins } = getEnvConfig().auth;
  const key = failKey(email);
  const count = parseInt((await getRedis().get(key)) ?? "0", 10);
  if (count >= maxFailedLogins) {
    const ttl = await getRedis().ttl(key);
    throw new AccountLockedError(ttl > 0 ? ttl : null);
  }
}

async function recordFailedAttempt(email: string): Promise<void> {
  const { lockoutWindowSec } = getEnvConfig().auth;
  const key = failKey(email);
  const count = await getRedis().incr(key);
  if (count === 1) await getRedis().expire(key, lockoutWindowSec);
}

async function clearFailedAttempts(email: string): Promise<void> {
  await getRedis().del(failKey(email));
}

export async function loginWithPassword({
  email,
  password,
}: LoginInput): Promise<LoginResult> {
  const { userAudience } = getEnvConfig().jwt;

  // 1. Pre-check lockout BEFORE expensive bcrypt — fail fast under attack
  await assertAccountNotLocked(email);

  const user = await findUserByEmail(email);

  if (!user) {
    await verifyPassword(password, DUMMY_HASH); // timing protection
    await recordFailedAttempt(email); // counted even for unknown emails to prevent enumeration
    throw new InvalidCredentialsError();
  }

  const valid = await verifyPassword(password, user.passwordHash);
  if (!valid) {
    await recordFailedAttempt(email);
    throw new InvalidCredentialsError();
  }

  if (user.status !== "active") throw new AccountNotActiveError();

  // Success — clear the failure counter so legitimate users with typos aren't penalized
  await clearFailedAttempts(email);

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
