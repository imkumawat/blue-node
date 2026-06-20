import jwt from "jsonwebtoken";
import type { JwtPayload } from "jsonwebtoken";
import { v7 as uuidv7 } from "uuid";
import { and, eq, isNull } from "drizzle-orm";
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
  sid?: string;
}

// Input claims for token generation (jti is generated internally, not passed in).
interface TokenClaims {
  sub: string; // user id
  sid?: string; // session id — server-generated per login, survives token rotation; powers per-session WS disconnect
}
interface AccessTokenClaims extends TokenClaims {
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
  audience: string,
  claims: AccessTokenClaims,
): IssuedToken {
  const { issuer } = getEnvConfig().jwt;
  const { secret, accessExpiry } = audienceConfig(audience);
  const jti = uuidv7();
  const token = jwt.sign({ ...claims, jti }, secret, {
    algorithm: "HS256",
    issuer,
    audience,
    expiresIn: accessExpiry,
  });
  const expiresAt = new Date(Date.now() + accessExpiry * 1000);
  return { token, jti, expiresAt };
}

export function generateRefreshToken(
  audience: string,
  claims: TokenClaims,
): IssuedToken {
  const { issuer } = getEnvConfig().jwt;
  const { secret, refreshExpiry } = audienceConfig(audience);
  const jti = uuidv7();
  const expiresAt = new Date(Date.now() + refreshExpiry * 1000);
  const token = jwt.sign({ ...claims, jti }, secret, {
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

export async function rotateRefreshToken(
  oldToken: string,
  audience: string,
): Promise<{ payload: TokenPayload; rotated: RefreshToken }> {
  const payload = verifyRefreshToken(oldToken, audience);

  // Atomic claim: flip rotated_at on the live row only (rotated_at IS NULL).
  // The conditional UPDATE takes a row lock, so among concurrent presenters of
  // the same jti exactly one matches and gets the row back via RETURNING; the
  // rest match zero rows. The "already rotated" evidence lives in the same row,
  // so a loser can never observe "row gone but marker absent" — this closes the
  // old DELETE-then-Redis-SET window without a second store.
  const [rotated] = await getDb()
    .update(refreshTokens)
    .set({ rotatedAt: new Date() })
    .where(
      and(eq(refreshTokens.jti, payload.jti), isNull(refreshTokens.rotatedAt)),
    )
    .returning();

  if (rotated) return { payload, rotated };

  // We didn't win the claim: the jti was either already rotated (reuse) or its
  // row is gone (logged out / expired / never existed). One read tells them apart.
  const [row] = await getDb()
    .select()
    .from(refreshTokens)
    .where(eq(refreshTokens.jti, payload.jti));

  if (row) {
    // Row present with rotated_at already set → a second use of a spent token →
    // REUSE. Wipe the whole family (kills the attacker's stolen rotated token too).
    await revokeAllRefreshTokensForUser(row.userId);
  }

  throw new InvalidRefreshTokenError();
}
