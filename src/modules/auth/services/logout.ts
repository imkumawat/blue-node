import { disconnectSession } from "../../../websocket/index.js";
import { revokeAccessToken } from "../infra/tokenStore.js";
import { deleteSession } from "../infra/sessionQueries.js";

interface LogoutParams {
  userId: string;
  sessionId: string;
}

export async function logoutUser({
  userId,
  sessionId,
}: LogoutParams): Promise<void> {
  // Kill this session's live sockets across all instances first. If this throws,
  // Redis is down — the blacklist below needs Redis too, so logout fails loudly
  // and the client retries (every step here is idempotent). No swallowing.
  await disconnectSession(userId, sessionId);
  await revokeAccessToken(sessionId);
  await deleteSession(sessionId, userId);
}
