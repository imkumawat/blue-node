import { getRedis } from "../../../lib/cache/redis/client.js";
import { getEnvConfig } from "../../../config/env.js";
import { generateId } from "../../../utils/generateId.js";
import {
  constantTimeEqual,
  hmacSha256,
  randomToken,
  sha256,
  randomNumericCode,
} from "../../../shared/utils/crypto.js";

/* ────────────────────────────────────────────────────────────────────────────
   OPAQUE · refresh token

   nf_rt_<sessionId>.<secret>

   The same shape as the access token above it, and for the same reason: the id
   is a PUBLIC routing component and the secret is the only part that proves
   anything. Carrying it means redeeming a refresh token starts as a primary-key
   read, and that ONE read says whether the presented secret is the live one, the
   one already spent, or neither.

   Keying the row by a hash of the whole token reads just as well — until the
   reuse check, which then needs a second query against a second index.

   The row itself lives in Postgres (sessions), not here. This module only shapes
   and hashes; nothing about the refresh token touches Redis.
   ──────────────────────────────────────────────────────────────────────────── */

const SECRET_BYTES = 32;

export interface MintedRefreshToken {
  /** Handed to the client. Exists in plaintext here and nowhere else. */
  token: string;
  /** Also the id of the session row this token belongs to. */
  sessionId: string;
  /** What gets stored. */
  tokenHash: string;
}

/**
 * Mints the first refresh token of a session, and the session's id with it.
 *
 * The id is generated here rather than defaulted by the database because the
 * token embeds it: it has to exist before the row is written, and both must
 * carry the same value.
 */
export function mintRefreshToken(): MintedRefreshToken {
  const { tokens } = getEnvConfig();

  const sessionId = generateId();
  const token = `${tokens.refreshPrefix}${sessionId}.${randomToken(SECRET_BYTES)}`;

  return { token, sessionId, tokenHash: hashRefreshToken(token) };
}

/**
 * Mints the replacement during a rotation.
 *
 * Separate from mintRefreshToken because the id must NOT change: the row is the
 * device, and it stays the same device across every rotation. That stability is
 * what keeps it identifiable in a login list and what per-session WebSocket
 * disconnect keys off.
 */
export function mintRotatedRefreshToken(sessionId: string): {
  token: string;
  tokenHash: string;
} {
  const { tokens } = getEnvConfig();
  const token = `${tokens.refreshPrefix}${sessionId}.${randomToken(SECRET_BYTES)}`;

  return { token, tokenHash: hashRefreshToken(token) };
}

export function hashRefreshToken(token: string): string {
  return hmacSha256(getEnvConfig().tokens.pepper, token);
}

/**
 * Splits a presented refresh token WITHOUT touching any store.
 *
 * Returns null on anything that is not our shape — including an OAuth grant's
 * refresh token, which carries a different prefix. Two families that look alike
 * would otherwise be told apart only by a lookup coming back empty.
 */
export function parseRefreshToken(token: string): { sessionId: string } | null {
  const { refreshPrefix } = getEnvConfig().tokens;
  if (!token.startsWith(refreshPrefix)) return null;

  const body = token.slice(refreshPrefix.length);
  const dot = body.indexOf(".");
  if (dot <= 0 || dot === body.length - 1) return null;

  const secret = body.slice(dot + 1);
  if (secret.includes(".")) return null;

  return { sessionId: body.slice(0, dot) };
}

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
