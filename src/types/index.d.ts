import type { Logger } from "pino";
import type { AuthUser } from "../modules/auth/index.js";

declare global {
  namespace Express {
    interface Request {
      requestId: string;
      logger: Logger;
      startTime: bigint;
      user: AuthUser | null;
      apiClient?: { id: string; clientName: string };
    }
  }
}

declare module "http" {
  interface IncomingMessage {
    requestId?: string;
    startTime?: bigint;
    rawBody?: Buffer;
  }
}

declare module "ws" {
  interface WebSocket {
    isAlive?: boolean;
    userExp?: number; // unix seconds — close the socket once the auth token expires
    userId?: string; // = AuthUser.id — owner of this socket
    sessionId?: string; // = AuthUser.sessionId (token `sid`) — per-session disconnect key
    connectionId?: string; // uuidv7 minted at accept — this socket's unique id
  }
}

export {};
