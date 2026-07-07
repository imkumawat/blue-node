import type { WebSocket } from "ws";
import type { AuthUser } from "../modules/auth/index.js";
import { sendToSocket, joinRoom, leaveRoom } from "./connectionManager.js";
import { subscribeRoom, unsubscribeRoom } from "./subscriber.js";
import { deliverToRoom } from "./publisher.js";
import { isRoomMember, saveRoomMessage } from "../modules/chat/index.js";
import logger from "../utils/logger.js";

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

  "room.join": async (msg, user, ws) => {
    if (!user) {
      return sendToSocket(ws, {
        type: "error",
        data: { message: "Auth required" },
      });
    }
    const roomId = String(msg.roomId);
    if (!(await isRoomMember(user.id, roomId))) {
      return sendToSocket(ws, {
        type: "error",
        data: { message: "Forbidden" },
      });
    }
    // Subscribe the room's cross-instance channel on the first local member.
    if (joinRoom(roomId, ws)) {
      void subscribeRoom(roomId).catch((err) =>
        logger.error({ err, roomId }, "WS room subscribe failed"),
      );
    }
    sendToSocket(ws, { type: "room.joined", data: { roomId } });
  },

  "room.leave": async (msg, _user, ws) => {
    const roomId = String(msg.roomId);
    // Unsubscribe the channel when the last local member leaves.
    if (leaveRoom(roomId, ws)) {
      void unsubscribeRoom(roomId).catch((err) =>
        logger.error({ err, roomId }, "WS room unsubscribe failed"),
      );
    }
  },

  "room.message": async (msg, user, ws) => {
    if (!user) return;
    const roomId = String(msg.roomId);
    if (!ws.rooms?.has(roomId)) return; // must have joined first
    const text = String(msg.text ?? "");
    await saveRoomMessage(roomId, user.id, text); // persist (source of truth)
    await deliverToRoom(
      roomId,
      { type: "room.message", data: { roomId, from: user.id, text } },
      ws.connectionId, // except-sender
    );
  },
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
