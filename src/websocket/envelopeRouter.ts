import type { WsEnvelope } from "./protocol.js";
import { WS_CLOSE_LOGGED_OUT } from "./protocol.js";
import {
  sendToUser,
  sendToSession,
  sendToRoom,
  closeUser,
  closeSession,
} from "./connectionManager.js";

/**
 * Route a cross-instance envelope to LOCAL sockets. The subscriber receives
 * envelopes from Redis; this dispatches each to the right connectionManager
 * action — room-targeted (roomId) or user-targeted (userId), deliver → send,
 * disconnect → close. The pub/sub analog of messageRouter.
 */
export function routeEnvelope(env: WsEnvelope): void {
  const {
    cmd,
    userId,
    sessionId,
    roomId,
    payload,
    closeCode,
    exceptConnectionId,
    reason = "session revoked",
  } = env;

  // Room-targeted (rooms only ever deliver, never disconnect)
  if (roomId) {
    if (cmd === "deliver") {
      sendToRoom(roomId, payload as string | object, exceptConnectionId);
    }
    return;
  }

  // User-targeted (userId is present on every user envelope)
  if (!userId) return;
  if (cmd === "deliver") {
    if (sessionId) sendToSession(userId, sessionId, payload as string | object);
    else sendToUser(userId, payload as string | object);
    return;
  }

  // cmd === "disconnect"
  const code = closeCode ?? WS_CLOSE_LOGGED_OUT;
  if (sessionId) closeSession(userId, sessionId, code, reason);
  else closeUser(userId, code, reason);
}
