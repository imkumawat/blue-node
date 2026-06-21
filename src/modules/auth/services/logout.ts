import { getEnvConfig } from "../../../config/env.js";
import {
  blacklistAccessToken,
  revokeRefreshToken,
  verifyRefreshToken,
} from "../lib/tokenService.js";
import { disconnectSession } from "../../../websocket/index.js";

interface LogoutParams {
  userId: string;
  sessionId: string;
  accessJti: string;
  accessExp: number;
  rawRefreshToken: string;
}

export async function logoutUser({
  userId,
  sessionId,
  accessJti,
  accessExp,
  rawRefreshToken,
}: LogoutParams): Promise<void> {
  // Kill this session's live sockets across all instances first. If this throws,
  // Redis is down — the blacklist below needs Redis too, so logout fails loudly
  // and the client retries (every step here is idempotent). No swallowing.
  await disconnectSession(userId, sessionId);

  const { userAudience } = getEnvConfig().jwt;
  const ttl = Math.max(0, accessExp - Math.floor(Date.now() / 1000));
  if (ttl > 0) await blacklistAccessToken(accessJti, ttl);

  const decoded = verifyRefreshToken(rawRefreshToken, userAudience);
  await revokeRefreshToken(decoded.jti);
}
