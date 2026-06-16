import type { WebSocket } from "ws";
import type { AuthUser } from "../modules/auth/index.js";

interface WSMessage {
  type: string;
  [k: string]: unknown;
}

type Handler = (msg: WSMessage, user: AuthUser, ws: WebSocket) => Promise<void>;

const handlers: Record<string, Handler> = {
  ping: async (_msg, _user, ws) => {
    ws.send(JSON.stringify({ type: "pong", ts: Date.now() }));
  },
  // Add real handlers as features arrive:
  //   "notifications.subscribe": ...,
  //   "presence.update": ...,
  //   "chat.send": ...,
};

export async function routeMessage(
  msg: WSMessage,
  user: AuthUser,
  ws: WebSocket,
): Promise<void> {
  const handler = handlers[msg?.type];
  if (!handler) {
    ws.send(JSON.stringify({ type: "error", message: "Unknown message type" }));
    return;
  }
  await handler(msg, user, ws);
}
