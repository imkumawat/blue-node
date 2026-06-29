import type { WebSocket } from "ws";
import { getEnvConfig } from "../config/env.js";
import logger from "../utils/logger.js";
import type { ServerMessage } from "./protocol.js";

// In-memory map: userId → Set<WebSocket>. One user can have multiple connections
// (multi-tab, multi-device). Per-process state — cross-instance fan-out is
// layered on top via Redis pub/sub (see publisher.ts / subscriber.ts).
const userConnections = new Map<string, Set<WebSocket>>();
// Public (unauthenticated) sockets have no userId, so they live in their own
// set rather than the per-user map. Used for public broadcasts.
const publicConnections = new Set<WebSocket>();
let totalConnections = 0; // live socket count on this instance (capacity cap)

/**
 * Send raw data to one socket with backpressure protection. ws.send() only
 * QUEUES bytes; if the client reads slowly the queue (bufferedAmount) grows
 * unbounded → OOM. Past the high-water mark the client can't keep up, so
 * terminate it — it will reconnect and resync from the source of truth (cheaper,
 * and safer, than silently dropping messages, which corrupts client state).
 */
function trySend(ws: WebSocket, data: string): void {
  if (ws.readyState !== ws.OPEN) return;
  if (ws.bufferedAmount > getEnvConfig().ws.maxBufferedBytes) {
    logger.warn(
      {
        userId: ws.userId,
        sessionId: ws.sessionId,
        bufferedAmount: ws.bufferedAmount,
      },
      "WS slow consumer — terminating",
    );
    ws.terminate();
    return;
  }
  ws.send(data);
}

/** Send a structured message to ONE socket (direct reply). No-op if not open. */
export function sendToSocket(ws: WebSocket, message: ServerMessage): void {
  trySend(ws, JSON.stringify(message));
}

export function addUserConnection(userId: string, ws: WebSocket): void {
  let set = userConnections.get(userId);
  if (!set) {
    set = new Set();
    userConnections.set(userId, set);
  }
  set.add(ws);
  totalConnections++;
}

export function removeUserConnection(userId: string, ws: WebSocket): void {
  const set = userConnections.get(userId);
  if (!set) return;
  if (set.delete(ws)) totalConnections--; // dec only if it was actually present
  if (set.size === 0) userConnections.delete(userId);
}

export function getUserConnections(userId: string): Set<WebSocket> {
  return userConnections.get(userId) ?? new Set();
}

/**
 * True if THIS instance currently holds any socket for the user. Drives the
 * pub/sub lifecycle: subscribe to the user's channel on the first local socket,
 * unsubscribe on the last.
 */
export function hasLocalUser(userId: string): boolean {
  return userConnections.has(userId);
}

/** Live socket count on THIS instance — drives the per-instance capacity cap. */
export function connectionCount(): number {
  return totalConnections;
}

/**
 * Send a payload to ALL of a user's open sockets. No-op if user offline.
 * Payload can be a string or an object (auto-JSON.stringify).
 */
export function sendToUser(userId: string, payload: string | object): void {
  const data = typeof payload === "string" ? payload : JSON.stringify(payload);
  for (const ws of getUserConnections(userId)) {
    trySend(ws, data);
  }
}

/**
 * Send a payload to ONE session's local sockets (a session can be open on
 * multiple tabs, all sharing the same sessionId). No-op if not on this instance.
 */
export function sendToSession(
  userId: string,
  sessionId: string,
  payload: string | object,
): void {
  const data = typeof payload === "string" ? payload : JSON.stringify(payload);
  for (const ws of getUserConnections(userId)) {
    if (ws.sessionId === sessionId) trySend(ws, data);
  }
}

/** Close ONE session's local sockets (that session logged out / was revoked). */
export function closeSession(
  userId: string,
  sessionId: string,
  code: number,
  reason: string,
): void {
  for (const ws of getUserConnections(userId)) {
    if (ws.sessionId === sessionId && ws.readyState === ws.OPEN) {
      ws.close(code, reason);
    }
  }
}

/** Close ALL of a user's local sockets (logout-everywhere / password change). */
export function closeUser(userId: string, code: number, reason: string): void {
  for (const ws of getUserConnections(userId)) {
    if (ws.readyState === ws.OPEN) ws.close(code, reason);
  }
}

/** Register a public (unauthenticated) socket — counts toward the capacity cap. */
export function addPublicConnection(ws: WebSocket): void {
  publicConnections.add(ws);
  totalConnections++;
}

export function removePublicConnection(ws: WebSocket): void {
  if (publicConnections.delete(ws)) totalConnections--;
}

/** Broadcast to ALL public sockets (announcements / public live data). */
export function broadcastPublic(payload: string | object): void {
  const data = typeof payload === "string" ? payload : JSON.stringify(payload);
  for (const ws of publicConnections) trySend(ws, data);
}

/** All userIds with at least one local socket — used to re-subscribe channels
 *  after a Redis reconnect. */
export function localUserIds(): string[] {
  return [...userConnections.keys()];
}
