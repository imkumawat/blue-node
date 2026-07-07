// Shared WebSocket protocol: app-private close codes + the cross-instance
// pub/sub envelope. Close codes are a CLIENT CONTRACT — keep them here (a
// protocol constant), not in appConfig (they are not env-tunable).

// 4000-4999 = application-private close codes.
export const WS_CLOSE_AUTH_EXPIRED = 4001; // token lifetime ended → client SHOULD reconnect with a fresh token
export const WS_CLOSE_LOGGED_OUT = 4002; // session logged out / revoked → client must NOT reconnect

/**
 * Redis pub/sub channel for a single user. Every instance currently hosting a
 * socket for that user subscribes to it; a publisher writes a WsEnvelope to it.
 * `prefix` comes from config (REDIS_KEYS.wsUser) so the key format lives there.
 */
export function userChannel(prefix: string, userId: string): string {
  return `${prefix}${userId}`;
}

/** Redis pub/sub channel for a single room (mirrors userChannel). */
export function roomChannel(prefix: string, roomId: string): string {
  return `${prefix}${roomId}`;
}

/**
 * What a publisher puts on a user channel. Every subscribing instance acts on
 * it against its LOCAL sockets only (deliver → send, disconnect → close).
 */
export interface WsEnvelope {
  v: 1; // envelope version — lets us evolve the shape later
  cmd: "deliver" | "disconnect";
  userId?: string; // user-targeted; absent on room envelopes
  sessionId?: string; // target one session; absent = all of the user's sessions
  roomId?: string; // room-targeted; absent on user envelopes
  payload?: unknown; // cmd: "deliver"
  closeCode?: number; // cmd: "disconnect"
  reason?: string; // cmd: "disconnect"
  exceptConnectionId?: string; // room deliver: skip the sender's own connection
}

/**
 * The shape of every message the SERVER sends to a CLIENT. `type` is the event
 * the client switches on, `data` carries the event payload, `ts` is an optional
 * server timestamp. One consistent shape → the client parses uniformly.
 */
export interface ServerMessage<T = unknown> {
  type: string;
  data?: T;
  ts?: number;
}
