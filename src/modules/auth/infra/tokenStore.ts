import { getRedis } from "../../../lib/cache/redis/client.js";
import { getEnvConfig } from "../../../config/env.js";
import {
  constantTimeEqual,
  hmacSha256,
  randomToken,
  sha256,
  randomNumericCode,
} from "../../../shared/utils/crypto.js";

export interface AccessTokenRecord {
  userId: string;
  sessionId: string;
  scopes: string[];
  exp: number;
}

interface StoredAccessRecord extends AccessTokenRecord {
  tokenHash: string;
}

function accessKeyFor(sessionId: string): string {
  return `${getEnvConfig().redis.keys.accessToken}${sessionId}`;
}

function parseAccessToken(
  token: string,
): { sessionId: string; secret: string } | null {
  const { accessPrefix } = getEnvConfig().tokens;
  if (!token.startsWith(accessPrefix)) return null;

  const body = token.slice(accessPrefix.length);
  const dot = body.indexOf(".");
  if (dot <= 0 || dot === body.length - 1) return null;

  const secret = body.slice(dot + 1);
  if (secret.includes(".")) return null;

  return { sessionId: body.slice(0, dot), secret };
}

export async function issueAccessToken(
  record: AccessTokenRecord,
): Promise<string> {
  const { tokens } = getEnvConfig();
  const token = `${tokens.accessPrefix}${record.sessionId}.${randomToken(32)}`;

  const stored: StoredAccessRecord = {
    ...record,
    tokenHash: hmacSha256(tokens.pepper, token),
  };

  await getRedis().set(
    accessKeyFor(record.sessionId),
    JSON.stringify(stored),
    "EX",
    tokens.accessExpiry,
  );

  return token;
}

export async function verifyAccessToken(
  token: string,
): Promise<AccessTokenRecord | null> {
  const parsed = parseAccessToken(token);
  if (!parsed) return null;

  const raw = await getRedis().get(accessKeyFor(parsed.sessionId));
  if (!raw) return null;

  let stored: StoredAccessRecord;
  try {
    stored = JSON.parse(raw) as StoredAccessRecord;
  } catch {
    return null;
  }

  const { tokens } = getEnvConfig();

  const presented = hmacSha256(tokens.pepper, token);
  if (!constantTimeEqual(presented, stored.tokenHash, "hex")) return null;

  const { tokenHash: _proof, ...record } = stored;
  return record;
}

export async function revokeAccessToken(sessionId: string): Promise<void> {
  await getRedis().del(accessKeyFor(sessionId));
}

export async function revokeAccessTokens(sessionIds: string[]): Promise<void> {
  if (sessionIds.length === 0) return;
  await getRedis().del(...sessionIds.map(accessKeyFor));
}

function emailVerifyKeyFor(userId: string): string {
  return `${getEnvConfig().redis.keys.emailVerify}${userId}`;
}

export async function createEmailVerificationCode(
  userId: string,
): Promise<string> {
  const { codeLength, ttlSec } = getEnvConfig().otp;
  const code = randomNumericCode(codeLength);
  const k = emailVerifyKeyFor(userId);

  await getRedis().del(k); // drop any previous code + attempts
  await getRedis().hset(k, { hash: sha256(code), attempts: "0" });
  await getRedis().expire(k, ttlSec);
  return code;
}

export async function verifyEmailVerificationCode(
  userId: string,
  code: string,
): Promise<boolean> {
  const { maxAttempts } = getEnvConfig().otp;
  const k = emailVerifyKeyFor(userId);

  const storedHash = await getRedis().hget(k, "hash");
  if (!storedHash) return false;

  const attempts = await getRedis().hincrby(k, "attempts", 1);
  if (attempts > maxAttempts) {
    await getRedis().del(k);
    return false;
  }

  if (!constantTimeEqual(storedHash, sha256(code), "hex")) return false;

  await getRedis().del(k);
  return true;
}

function passwordResetKeyFor(userId: string): string {
  return `${getEnvConfig().redis.keys.passwordReset}${userId}`;
}

export async function createPasswordResetCode(userId: string): Promise<string> {
  const { codeLength, ttlSec } = getEnvConfig().otp;
  const code = randomNumericCode(codeLength);
  const k = passwordResetKeyFor(userId);

  await getRedis().del(k);
  await getRedis().hset(k, { hash: sha256(code), attempts: "0" });
  await getRedis().expire(k, ttlSec);
  return code;
}

export async function verifyPasswordResetCode(
  userId: string,
  code: string,
): Promise<boolean> {
  const { maxAttempts } = getEnvConfig().otp;
  const k = passwordResetKeyFor(userId);

  const storedHash = await getRedis().hget(k, "hash");
  if (!storedHash) return false;

  const attempts = await getRedis().hincrby(k, "attempts", 1);
  if (attempts > maxAttempts) {
    await getRedis().del(k);
    return false;
  }

  if (!constantTimeEqual(storedHash, sha256(code), "hex")) return false;

  await getRedis().del(k);
  return true;
}
