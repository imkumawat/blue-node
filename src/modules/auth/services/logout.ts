import { getEnvConfig } from "../../../config/env.js";
import {
  blacklistAccessToken,
  revokeRefreshToken,
  verifyRefreshToken,
} from "../lib/tokenService.js";

interface LogoutParams {
  accessJti: string;
  accessExp: number;
  rawRefreshToken: string;
}

export async function logoutUser({
  accessJti,
  accessExp,
  rawRefreshToken,
}: LogoutParams): Promise<void> {
  const { userAudience } = getEnvConfig().jwt;
  const ttl = Math.max(0, accessExp - Math.floor(Date.now() / 1000));
  if (ttl > 0) await blacklistAccessToken(accessJti, ttl);

  const decoded = verifyRefreshToken(rawRefreshToken, userAudience);
  await revokeRefreshToken(decoded.jti);
}
