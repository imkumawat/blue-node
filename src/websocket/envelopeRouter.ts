import type { WsEnvelope } from "./protocol.js";
import { WS_CLOSE_LOGGED_OUT } from "./protocol.js";
import {
  sendToUser,
  sendToSession,
  closeUser,
  closeSession,
} from "./connectionManager.js";

/**
 * Route a cross-instance envelope to LOCAL sockets. The subscriber receives
 * envelopes from Redis; this dispatches each to the right connectionManager
 * action (deliver → send, disconnect → close), filtered by sessionId when set.
 * The pub/sub analog of messageRouter (which routes client messages by type).
 */
export function routeEnvelope(env: WsEnvelope): void {
  const {
    v: _v,
    cmd,
    userId,
    sessionId,
    payload,
    closeCode,
    reason = "session revoked",
  } = env;
  if (cmd === "deliver") {
    if (sessionId) {
      sendToSession(userId, sessionId, payload as string | object);
    } else {
      sendToUser(userId, payload as string | object);
    }
    return;
  }

  // cmd === "disconnect"
  const code = closeCode ?? WS_CLOSE_LOGGED_OUT;

  if (sessionId) closeSession(userId, sessionId, code, reason);
  else closeUser(userId, code, reason);
}
