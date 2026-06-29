import type { WebSocket } from "ws";
import type { AuthUser } from "../modules/auth/index.js";
import { sendToSocket } from "./connectionManager.js";

interface WSMessage {
  type: string;
  [k: string]: unknown;
}

// user is null for public (unauthenticated) connections — user-specific
// handlers must null-check before acting.
type Handler = (
  msg: WSMessage,
  user: AuthUser | null,
  ws: WebSocket,
) => Promise<void>;

const handlers: Record<string, Handler> = {
  ping: async (_msg, _user, ws) => {
    sendToSocket(ws, { type: "pong", ts: Date.now() });
  },
  // Add real handlers as features arrive:
  //   "notifications.subscribe": ...,
  //   "presence.update": ...,
  //   "chat.send": ...,
};

export async function routeMessage(
  msg: WSMessage,
  user: AuthUser | null,
  ws: WebSocket,
): Promise<void> {
  const handler = handlers[msg?.type];
  if (!handler) {
    sendToSocket(ws, {
      type: "error",
      data: { message: "Unknown message type" },
    });
    return;
  }
  await handler(msg, user, ws);
}
