import { getEnvConfig } from "../../../config/env.js";
import { getScopes } from "../lib/permissionQueries.js";
import {
  rotateRefreshToken,
  generateAccessToken,
  generateRefreshToken,
  storeRefreshToken,
} from "../lib/tokenService.js";
import type { IssuedToken } from "../lib/tokenService.js";

export async function renewTokens(
  rawRefreshToken: string,
): Promise<{ access: IssuedToken; refresh: IssuedToken }> {
  const { userAudience } = getEnvConfig().jwt;
  const { payload } = await rotateRefreshToken(rawRefreshToken, userAudience);

  const scopes = await getScopes(payload.sub);
  // Thread the session id through rotation so a refreshed token keeps the SAME
  // sid — the WS layer's per-session disconnect stays stable across the 15-min
  // access-token rotation.
  const access = generateAccessToken(userAudience, {
    sub: payload.sub,
    scopes,
    sid: payload.sid,
  });
  const refresh = generateRefreshToken(userAudience, {
    sub: payload.sub,
    sid: payload.sid,
  });
  await storeRefreshToken(
    payload.sub,
    refresh.jti,
    refresh.expiresAt,
    access.jti,
    access.expiresAt,
  );

  return { access, refresh };
}
