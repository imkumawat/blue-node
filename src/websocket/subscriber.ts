import type { Redis } from "ioredis";
import { getRedis } from "../lib/cache/redis/client.js";
import { getEnvConfig } from "../config/env.js";
import { userChannel, WS_CLOSE_LOGGED_OUT } from "./protocol.js";
import type { WsEnvelope } from "./protocol.js";
import {
  sendToUser,
  sendToSession,
  closeUser,
  closeSession,
  localUserIds,
} from "./connectionManager.js";
import logger from "../utils/logger.js";

let _sub: Redis | undefined;

function channelFor(userId: string): string {
  return userChannel(getEnvConfig().redis.keys.wsUser, userId);
}

function requireSub(): Redis {
  if (!_sub) {
    throw new Error(
      "WS subscriber not initialized. Call initWsPubsub() first.",
    );
  }
  return _sub;
}

/** Start the subscriber — a dedicated DUPLICATE connection (an ioredis client in
 *  subscribe mode can't run normal commands). Routes incoming envelopes to LOCAL
 *  sockets only. Call once at boot, after Redis is connected. */
export async function initWsPubsub(): Promise<void> {
  _sub = getRedis().duplicate();

  _sub.on("message", (_channel, raw) => {
    let env: WsEnvelope;
    try {
      env = JSON.parse(raw) as WsEnvelope;
    } catch (err) {
      logger.warn({ err }, "WS subscriber: bad envelope");
      return;
    }
    if (env.cmd === "deliver") {
      if (env.sessionId) {
        sendToSession(
          env.userId,
          env.sessionId,
          env.payload as string | object,
        );
      } else {
        sendToUser(env.userId, env.payload as string | object);
      }
    } else {
      const code = env.closeCode ?? WS_CLOSE_LOGGED_OUT;
      const reason = env.reason ?? "session revoked";
      if (env.sessionId) closeSession(env.userId, env.sessionId, code, reason);
      else closeUser(env.userId, code, reason);
    }
  });

  // Defensive re-subscribe on every (re)connect. ioredis re-subscribes tracked
  // channels itself (autoResubscribe defaults to true), so this is a belt-and-
  // suspenders restore of all users this instance hosts — and documents the
  // invariant: subscriptions are per-connection state, not data Redis keeps.
  _sub.on("ready", () => {
    const channels = localUserIds().map(channelFor);
    if (channels.length) {
      requireSub()
        .subscribe(...channels)
        .catch((err) => logger.error({ err }, "WS re-subscribe failed"));
    }
  });

  logger.info("WS subscriber initialized");
}

/** Subscribe to a user's channel — on the FIRST local socket for that user. */
export async function subscribeUser(userId: string): Promise<void> {
  await requireSub().subscribe(channelFor(userId));
}

/** Unsubscribe — on the LAST local socket for that user closing. */
export async function unsubscribeUser(userId: string): Promise<void> {
  await requireSub().unsubscribe(channelFor(userId));
}

export async function closeWsPubsub(): Promise<void> {
  try {
    await _sub?.quit();
  } catch (err) {
    logger.warn({ err }, "WS subscriber quit failed");
  }
  _sub = undefined;
}
