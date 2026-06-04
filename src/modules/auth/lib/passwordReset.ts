import { getRedis } from "../../../lib/cache/redis/client.js";
import { getEnvConfig } from "../../../config/env.js";
import {
  sha256,
  randomNumericCode,
  constantTimeEqual,
} from "../../../shared/utils/crypto.js";

// Mirrors lib/emailVerification.ts but on a separate keyspace — a pending
// email-verify code and a password-reset code can coexist for the same user
// without clobbering each other. Keyed by userId (not email): no raw PII in keys.
function key(userId: string): string {
  return `${getEnvConfig().redis.keys.passwordReset}${userId}`;
}

// Generate a fresh code, store only its HASH (never plaintext) with a TTL +
// attempt counter, and return the plaintext to be emailed. Overwrites any
// existing code (a re-request invalidates the previous one).
export async function createPasswordResetCode(userId: string): Promise<string> {
  const { codeLength, ttlSec } = getEnvConfig().otp;
  const code = randomNumericCode(codeLength);
  const k = key(userId);
  const redis = getRedis();
  await redis.del(k); // drop any previous code + attempts
  await redis.hset(k, { hash: sha256(code), attempts: "0" });
  await redis.expire(k, ttlSec);
  return code;
}

// Verify a submitted code. true → match (consumed, single-use). false →
// missing/expired/wrong. After otp.maxAttempts wrong tries the code is burned
// (forces a re-request) to bound brute-force.
export async function verifyPasswordResetCode(
  userId: string,
  code: string,
): Promise<boolean> {
  const { maxAttempts } = getEnvConfig().otp;
  const k = key(userId);
  const redis = getRedis();

  const storedHash = await redis.hget(k, "hash");
  if (!storedHash) return false; // expired or never issued

  const attempts = await redis.hincrby(k, "attempts", 1);
  if (attempts > maxAttempts) {
    await redis.del(k); // too many tries — invalidate
    return false;
  }

  if (!constantTimeEqual(storedHash, sha256(code), "hex")) return false;

  await redis.del(k); // single-use
  return true;
}
