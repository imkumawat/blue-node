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
  const access = generateAccessToken(payload.sub, scopes, userAudience);
  const refresh = generateRefreshToken(payload.sub, userAudience);
  await storeRefreshToken(
    payload.sub,
    refresh.jti,
    refresh.expiresAt,
    access.jti,
    access.expiresAt,
  );

  return { access, refresh };
}
