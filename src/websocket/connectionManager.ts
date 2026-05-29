import type { WebSocket } from "ws";

// In-memory map: userId → Set<WebSocket>. One user can have multiple connections
// (multi-tab, multi-device). Per-process state — for multi-instance prod, layer
// Redis pub/sub on top to broadcast across Node instances.

const connections = new Map<string, Set<WebSocket>>();

export function addConnection(userId: string, ws: WebSocket): void {
  if (!connections.has(userId)) connections.set(userId, new Set());
  connections.get(userId)!.add(ws);
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
