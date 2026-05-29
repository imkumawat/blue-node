import jwt from "jsonwebtoken";
import type { JwtPayload } from "jsonwebtoken";
import { v7 as uuidv7 } from "uuid";
import { eq } from "drizzle-orm";
import { getDb } from "../../../lib/db/postgres/client.js";
import { getRedis } from "../../../lib/cache/redis/client.js";
import { refreshTokens } from "../../../models/postgres/user/refreshToken.js";
import type { RefreshToken } from "../../../models/postgres/user/refreshToken.js";
import { getEnvConfig } from "../../../config/env.js";
import {
  InvalidRefreshTokenError,
  TokenExpiredError,
  InvalidTokenError,
  TokenRevokedError,
} from "../errors.js";

export interface IssuedToken {
  token: string;
  jti: string;
  expiresAt: Date;
}

interface AudienceConfig {
  secret: string;
  accessExpiry: number;
  refreshExpiry: number;
}

interface TokenPayload extends JwtPayload {
  sub: string;
  jti: string;
  scopes?: string[];
}

function audienceConfig(audience: string): AudienceConfig {
  const {
    userAudience,
    adminAudience,
    userSecret,
    adminSecret,
    userAccessExpiry,
    adminAccessExpiry,
    userRefreshExpiry,
    adminRefreshExpiry,
  } = getEnvConfig().jwt;

  if (audience === userAudience) {
    return {
      secret: userSecret,
      accessExpiry: userAccessExpiry,
      refreshExpiry: userRefreshExpiry,
    };
  }
  if (audience === adminAudience) {
    return {
      secret: adminSecret,
      accessExpiry: adminAccessExpiry,
      refreshExpiry: adminRefreshExpiry,
    };
  }
  throw new Error(`Unknown JWT audience: ${audience}`);
}

export function generateAccessToken(
  userId: string,
  scopes: string[] = [],
  audience: string,
): IssuedToken {
  const { issuer } = getEnvConfig().jwt;
  const { secret, accessExpiry } = audienceConfig(audience);
  const jti = uuidv7();
  const token = jwt.sign({ sub: String(userId), scopes, jti }, secret, {
    algorithm: "HS256",
    issuer,
    audience,
    expiresIn: accessExpiry,
  });
  const expiresAt = new Date(Date.now() + accessExpiry * 1000);
  return { token, jti, expiresAt };
}

export function generateRefreshToken(
  userId: string,
  audience: string,
): IssuedToken {
  const { issuer } = getEnvConfig().jwt;
  const { secret, refreshExpiry } = audienceConfig(audience);
  const jti = uuidv7();
  const expiresAt = new Date(Date.now() + refreshExpiry * 1000);
  const token = jwt.sign({ sub: String(userId), jti }, secret, {
    algorithm: "HS256",
    issuer,
    audience,
    expiresIn: refreshExpiry,
  });
  return { token, jti, expiresAt };
}

export async function verifyAccessToken(
  token: string,
  audience: string,
): Promise<TokenPayload> {
  const { issuer } = getEnvConfig().jwt;
  const { blacklist } = getEnvConfig().redis.keys;
  const { secret } = audienceConfig(audience);

  let payload: TokenPayload;
  try {
    payload = jwt.verify(token, secret, {
      algorithms: ["HS256"],
      issuer,
      audience,
    }) as TokenPayload;
  } catch (err) {
    throw err instanceof Error && err.name === "TokenExpiredError"
      ? new TokenExpiredError()
      : new InvalidTokenError();
  }

  const blacklisted = await getRedis().exists(`${blacklist}${payload.jti}`);
  if (blacklisted) throw new TokenRevokedError();

  return payload;
}

export function verifyRefreshToken(
  token: string,
  audience: string,
): TokenPayload {
  const { issuer } = getEnvConfig().jwt;
  const { secret } = audienceConfig(audience);
  try {
    return jwt.verify(token, secret, {
      algorithms: ["HS256"],
      issuer,
      audience,
    }) as TokenPayload;
  } catch (err) {
    throw err instanceof Error && err.name === "TokenExpiredError"
      ? new TokenExpiredError()
      : new InvalidTokenError();
  }
}

export function decodeToken(token: string): TokenPayload | null {
  try {
    return jwt.decode(token) as TokenPayload | null;
  } catch {
    return null;
  }
}

export async function blacklistAccessToken(
  jti: string,
  ttlSeconds: number,
): Promise<void> {
  const { blacklist } = getEnvConfig().redis.keys;
  await getRedis().set(`${blacklist}${jti}`, "1", "EX", ttlSeconds);
}

export async function storeRefreshToken(
  userId: string,
  jti: string,
  expiresAt: Date,
  accessJti: string,
  accessExp: Date,
): Promise<void> {
  await getDb()
    .insert(refreshTokens)
    .values({ userId, jti, expiresAt, accessJti, accessExp });
}

export async function revokeRefreshToken(jti: string): Promise<void> {
  await getDb().delete(refreshTokens).where(eq(refreshTokens.jti, jti));
}

export async function revokeAllRefreshTokensForUser(
  userId: string,
): Promise<void> {
  await getDb().delete(refreshTokens).where(eq(refreshTokens.userId, userId));
}

async function markTokenAsRotated(
  jti: string,
  userId: string,
  audience: string,
): Promise<void> {
  const { refreshRotated } = getEnvConfig().redis.keys;
  const { refreshExpiry } = audienceConfig(audience);
  await getRedis().set(
    `${refreshRotated}${jti}`,
    String(userId),
    "EX",
    refreshExpiry,
  );
}

async function getRotatedTokenOwner(jti: string): Promise<string | null> {
  const { refreshRotated } = getEnvConfig().redis.keys;
  return getRedis().get(`${refreshRotated}${jti}`);
}

export async function rotateRefreshToken(
  oldToken: string,
  audience: string,
): Promise<{ payload: TokenPayload; deleted: RefreshToken }> {
  const payload = verifyRefreshToken(oldToken, audience);
  const [deleted] = await getDb()
    .delete(refreshTokens)
    .where(eq(refreshTokens.jti, payload.jti))
    .returning();

  if (deleted) {
    // Normal rotation — mark this jti as rotated so future presentations are detected as reuse.
    await markTokenAsRotated(payload.jti, deleted.userId, audience);
    return { payload, deleted };
  }

  // JWT valid but jti not in DB — could be expired OR reused. Check Redis marker.
  const rotatedOwner = await getRotatedTokenOwner(payload.jti);
  if (rotatedOwner) {
    // REUSE DETECTED — wipe all this user's refresh tokens (kills attacker's stolen rotated token too).
    await revokeAllRefreshTokensForUser(rotatedOwner);
  }

  throw new InvalidRefreshTokenError();
}
