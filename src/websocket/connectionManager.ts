import type { WebSocket } from "ws";

// In-memory map: userId → Set<WebSocket>. One user can have multiple connections
// (multi-tab, multi-device). Per-process state — for multi-instance prod, layer
// Redis pub/sub on top to broadcast across Node instances.

const connections = new Map<string, Set<WebSocket>>();

export function addConnection(userId: string, ws: WebSocket): void {
  let set = connections.get(userId);
  if (!set) {
    set = new Set();
    connections.set(userId, set);
  }
  set.add(ws);
}

export function removeConnection(userId: string, ws: WebSocket): void {
  const set = connections.get(userId);
  if (!set) return;
  set.delete(ws);
  if (set.size === 0) connections.delete(userId);
}

export function getConnections(userId: string): Set<WebSocket> {
  return connections.get(userId) ?? new Set();
}

/**
 * Send a payload to ALL of a user's open connections. No-op if user offline.
 * Payload can be a string or an object (auto-JSON.stringify).
 */
export function sendToUser(userId: string, payload: string | object): void {
  const data = typeof payload === "string" ? payload : JSON.stringify(payload);
  for (const ws of getConnections(userId)) {
    if (ws.readyState === ws.OPEN) ws.send(data);
  }
}

/**
 * True if THIS instance currently holds any socket for the user. Drives the
 * pub/sub lifecycle: subscribe to the user's channel on the first local socket,
 * unsubscribe on the last.
 */
export function hasLocalUser(userId: string): boolean {
  return connections.has(userId);
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
  for (const ws of getConnections(userId)) {
    if (ws.sessionId === sessionId && ws.readyState === ws.OPEN) ws.send(data);
  }
}

/** Close ONE session's local sockets (that session logged out / was revoked). */
export function closeSession(
  userId: string,
  sessionId: string,
  code: number,
  reason: string,
): void {
  for (const ws of getConnections(userId)) {
    if (ws.sessionId === sessionId && ws.readyState === ws.OPEN) {
      ws.close(code, reason);
    }
  }
}

/** Close ALL of a user's local sockets (logout-everywhere / password change). */
export function closeUser(userId: string, code: number, reason: string): void {
  for (const ws of getConnections(userId)) {
    if (ws.readyState === ws.OPEN) ws.close(code, reason);
  }
}

/** All userIds with at least one local socket — used to re-subscribe channels
 *  after a Redis reconnect. */
export function localUserIds(): string[] {
  return [...connections.keys()];
}
