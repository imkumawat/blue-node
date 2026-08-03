import type { Logger } from "pino";
import type { AuthSession } from "../modules/auth/index.js";
import type { GrantAccessClaims } from "../modules/oauth/index.js";

declare global {
  namespace Express {
    interface Request {
      requestId: string;
      logger: Logger;
      startTime: bigint;

      // A FIRST-PARTY principal: a user on one of their own devices.
      session: AuthSession | null;

      // A DELEGATED principal: a third-party app acting for a user under a
      // grant. Deliberately its own property rather than a widened `session` —
      // a grant has no device and no session id, so it would mean an empty
      // field that the WebSocket layer keys per-session disconnect off.
      //
      // Optional rather than nullable because, unlike `session`, nothing sets
      // it on the ordinary request path: only the MCP surface ever populates it.
      grant?: GrantAccessClaims;

      apiClient?: { id: string; clientName: string };
    }
  }
}

declare module "http" {
  interface IncomingMessage {
    pathname?: string; // parsed URL pathname for WS upgrade pre-checks
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
    rooms?: Set<string>; // rooms this socket has joined — for disconnect cleanup
  }
}

declare module "express-serve-static-core" {
  interface IRouter {
    /** HTTP QUERY — safe, idempotent read with a request body. Not yet in @types/express. */
    query: IRouterMatcher<this>;
  }
}

export {};
