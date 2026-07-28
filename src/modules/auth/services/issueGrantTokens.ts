import { v7 as uuidv7 } from "uuid";
import {
  generateAccessToken,
  generateRefreshToken,
  storeRefreshToken,
} from "../lib/tokenService.js";

export interface GrantTokens {
  accessToken: string;
  refreshToken: string;
  expiresInSec: number;
}

/**
 * Mints the token pair for an OAuth grant.
 *
 * This exists so modules/oauth never has to touch auth's lib/ — the
 * refresh_tokens table, and the rotation and reuse-detection logic guarding it,
 * stay owned by exactly one module. OAuth owns the delegation policy (clients,
 * PKCE, codes, consent); this owns the credentials.
 */
export async function issueGrantTokens({
  userId,
  grantId,
  scopes,
  audience,
}: {
  userId: string;
  grantId: string;
  scopes: string[];
  audience: string;
}): Promise<GrantTokens> {
  // A fresh session per exchange. `sid` is what per-session disconnect keys off,
  // so an app authorised twice gets two independently revocable sessions instead
  // of silently sharing one.
  const sessionId = uuidv7();

  const access = generateAccessToken(audience, {
    sub: userId,
    sid: sessionId,
    gid: grantId,
    scopes,
  });

  const refresh = generateRefreshToken(audience, {
    sub: userId,
    sid: sessionId,
    gid: grantId,
  });

  await storeRefreshToken(
    userId,
    refresh.jti,
    refresh.expiresAt,
    access.jti,
    access.expiresAt,
    grantId,
  );

  return {
    accessToken: access.token,
    refreshToken: refresh.token,
    expiresInSec: Math.max(
      0,
      Math.floor((access.expiresAt.getTime() - Date.now()) / 1000),
    ),
  };
}
