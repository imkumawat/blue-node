import { getRedis } from "../lib/cache/redis/client.js";
import { getEnvConfig } from "../config/env.js";
import { userChannel, roomChannel, WS_CLOSE_LOGGED_OUT } from "./protocol.js";
import type { WsEnvelope } from "./protocol.js";

// Publish a delivery/control envelope on a user's channel. Every instance
// hosting that user receives it and acts on its LOCAL sockets. Config is read at
// call time (these are called from other modules, e.g. auth logout).
async function publish(userId: string, env: WsEnvelope): Promise<void> {
  const { wsUser } = getEnvConfig().redis.keys;
  await getRedis().publish(userChannel(wsUser, userId), JSON.stringify(env));
}

/** Deliver a payload to ALL of a user's sockets, across every instance. */
export async function deliverToUser(
  userId: string,
  payload: unknown,
): Promise<void> {
  await publish(userId, { v: 1, cmd: "deliver", userId, payload });
}

/** Deliver a payload to a room's sockets across every instance, optionally
 *  excluding the sender's own connection (except-self broadcast). */
export async function deliverToRoom(
  roomId: string,
  payload: unknown,
  exceptConnectionId?: string,
): Promise<void> {
  const { wsRoom } = getEnvConfig().redis.keys;
  const env: WsEnvelope = {
    v: 1,
    cmd: "deliver",
    roomId,
    payload,
    exceptConnectionId,
  };
  await getRedis().publish(roomChannel(wsRoom, roomId), JSON.stringify(env));
}

/** Deliver a payload to ONE session's sockets, across every instance. */
export async function deliverToSession(
  userId: string,
  sessionId: string,
  payload: unknown,
): Promise<void> {
  await publish(userId, { v: 1, cmd: "deliver", userId, sessionId, payload });
}

/** Close ONE session's sockets across every instance (per-device logout). */
export async function disconnectSession(
  userId: string,
  sessionId: string,
  reason = "logged out",
): Promise<void> {
  await publish(userId, {
    v: 1,
    cmd: "disconnect",
    userId,
    sessionId,
    closeCode: WS_CLOSE_LOGGED_OUT,
    reason,
  });
}

/** Close ALL of a user's sockets across every instance (logout-everywhere / password change). */
export async function disconnectUser(
  userId: string,
  reason = "session revoked",
): Promise<void> {
  await publish(userId, {
    v: 1,
    cmd: "disconnect",
    userId,
    closeCode: WS_CLOSE_LOGGED_OUT,
    reason,
  });
}
