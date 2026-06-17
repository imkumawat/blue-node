import { WebSocketServer } from "ws";
import type { WebSocket, RawData } from "ws";
import type { Server } from "http";
import type { IncomingMessage } from "http";
import type { Duplex } from "stream";
import cookie from "cookie";
import { verifyToken } from "../modules/auth/index.js";
import type { AuthUser } from "../modules/auth/index.js";
import { addConnection, removeConnection } from "./connectionManager.js";
import { routeMessage } from "./messageRouter.js";
import logger from "../utils/logger.js";
import type { AppConfig } from "../config/env.js";

// App-private WebSocket close code (4000-4999 range). Client contract: reconnect
// with a fresh token. A protocol constant, not a tunable, so it stays here — the
// tunables (path / payload cap / heartbeat) live in appConfig → config.ws.
const WS_CLOSE_AUTH_EXPIRED = 4001;

/**
 * Attaches a WebSocket server to the existing httpServer. Auth happens during
 * the HTTP-to-WS upgrade handshake (before accept) — same JWT cookie/Bearer
 * flow as REST/GraphQL via `verifyToken` application use case.
 *
 * Returns the WebSocketServer instance so server.ts can manage shutdown.
 */
export function attachWebSocketServer(
  httpServer: Server,
  config: AppConfig,
): WebSocketServer {
  const { jwt } = config;
  const allowedOrigins = config.cors.allowedOrigins
    .split(",")
    .map((o) => o.trim());
  const wss = new WebSocketServer({
    noServer: true,
    maxPayload: config.ws.maxPayloadBytes,
  });

  httpServer.on("upgrade", (req, socket, head) => {
    void handleUpgrade(req, socket, head);
  });

  async function handleUpgrade(
    req: IncomingMessage,
    socket: Duplex,
    head: Buffer,
  ): Promise<void> {
    try {
      const url = new URL(req.url ?? "", `http://${req.headers.host}`);
      if (url.pathname !== config.ws.path) {
        socket.destroy();
        return;
      }

      // CSWSH defense: the WS upgrade is NOT subject to CORS, and a browser
      // attaches cookies automatically on a cross-origin handshake — so a
      // malicious page could open an authenticated socket as the victim.
      // Validate Origin against the same allowlist as REST/GraphQL CORS.
      const origin = req.headers.origin;
      if (origin && !allowedOrigins.includes(origin)) {
        return rejectUpgrade(socket, 403);
      }

      const { token: accessToken, viaCookie } = extractToken(req);
      if (!accessToken) return rejectUpgrade(socket, 401);

      // A browser always sends Origin, so a cookie-authenticated upgrade with
      // no Origin is anomalous → reject. Bearer tokens can't be set cross-site
      // by a browser, so native/non-browser clients (which omit Origin) stay
      // allowed.
      if (viaCookie && !origin) return rejectUpgrade(socket, 403);

      const user = await verifyToken(accessToken, jwt.userAudience);

      wss.handleUpgrade(req, socket, head, (ws) => {
        handleConnection(ws, user);
      });
    } catch (err) {
      logger.warn({ err }, "WS upgrade failed");
      rejectUpgrade(socket, 401);
    }
  }

  function handleConnection(ws: WebSocket, user: AuthUser): void {
    addConnection(user.id, ws);
    logger.info({ userId: user.id }, "WS connected");

    ws.isAlive = true;
    ws.userExp = user.exp;
    ws.on("pong", () => {
      ws.isAlive = true;
    });

    ws.on("message", (raw: RawData) => {
      void (async () => {
        try {
          const msg = JSON.parse(raw.toString());
          await routeMessage(msg, user, ws);
        } catch (err) {
          logger.warn({ err, userId: user.id }, "WS message handling failed");
          if (ws.readyState === ws.OPEN) {
            ws.send(JSON.stringify({ type: "error", message: "Bad message" }));
          }
        }
      })();
    });

    ws.on("close", () => {
      removeConnection(user.id, ws);
      logger.info({ userId: user.id }, "WS disconnected");
    });

    ws.on("error", (err) => {
      logger.error({ err, userId: user.id }, "WS error");
    });
  }

  // Heartbeat sweep — close expired sessions, then terminate dead connections.
  const heartbeat = setInterval(() => {
    const nowSec = Date.now() / 1000;
    wss.clients.forEach((ws) => {
      // Auth is verified only at connect (WS has no per-message middleware), so
      // close the socket once the token's own lifetime is up — otherwise an
      // expired session lingers on the open connection. 4001 = app close code.
      if (ws.userExp && ws.userExp <= nowSec)
        return ws.close(WS_CLOSE_AUTH_EXPIRED, "auth expired");
      if (!ws.isAlive) return ws.terminate();
      ws.isAlive = false;
      ws.ping();
    });
  }, config.ws.heartbeatIntervalMs);

  wss.on("close", () => clearInterval(heartbeat));

  return wss;
}

function extractToken(req: IncomingMessage): {
  token: string | null;
  viaCookie: boolean;
} {
  const cookies = cookie.parse(req.headers.cookie ?? "");
  if (cookies.access_token) {
    return { token: cookies.access_token, viaCookie: true };
  }
  const auth = req.headers.authorization;
  const token = auth?.startsWith("Bearer ") ? auth.slice(7) : null;
  return { token, viaCookie: false };
}

function rejectUpgrade(socket: Duplex, status: number): void {
  const reason =
    status === 401
      ? "Unauthorized"
      : status === 403
        ? "Forbidden"
        : "Bad Request";
  socket.write(`HTTP/1.1 ${status} ${reason}\r\n\r\n`);
  socket.destroy();
}
