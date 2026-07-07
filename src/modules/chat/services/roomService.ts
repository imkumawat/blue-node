import logger from "../../../utils/logger.js";

// Room membership + persistence for chat rooms. STUBS for now — the WebSocket
// rooms transport is wired against these; fill in real DB logic once the chat
// Mongo models exist. Kept in the chat module (feature/domain), not in the
// websocket/ transport layer.

/**
 * Whether a user is allowed to be in a room (e.g. a participant of the
 * conversation/group the room represents).
 * TODO(security): real membership check against the conversation/group in DB.
 */
export async function isRoomMember(
  userId: string,
  roomId: string,
): Promise<boolean> {
  return Boolean(userId && roomId); // STUB — allow when both ids present
}

/**
 * Persist a room message (source of truth for history/offline).
 * TODO: write to the messages collection (Mongo) with the conversation/room ref.
 */
export async function saveRoomMessage(
  roomId: string,
  senderId: string,
  text: string,
): Promise<void> {
  logger.info({ roomId, senderId, text }, "saveRoomMessage (stub)");
}
