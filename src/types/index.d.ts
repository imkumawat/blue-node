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
  }
}

export {};
