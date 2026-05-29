import { WebSocketServer } from "ws";
import type { WebSocket, RawData } from "ws";
import type { Server } from "http";
import type { IncomingMessage } from "http";
import type { Duplex } from "stream";
import cookie from "cookie";
import { verifyToken } from "../modules/auth/services/verifyToken.js";
import type { AuthUser } from "../modules/auth/services/verifyToken.js";
import { addConnection, removeConnection } from "./connectionManager.js";
import { routeMessage } from "./messageRouter.js";
import logger from "../utils/logger.js";
import type { AppConfig } from "../config/env.js";

const WS_PATH = "/ws";
const MAX_PAYLOAD_BYTES = 16 * 1024; // 16KB — reject huge messages
const HEARTBEAT_INTERVAL_MS = 30_000;

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
  const wss = new WebSocketServer({
    noServer: true,
    maxPayload: MAX_PAYLOAD_BYTES,
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
      if (url.pathname !== WS_PATH) {
        socket.destroy();
        return;
      }

      const accessToken = extractToken(req);
      if (!accessToken) return rejectUpgrade(socket, 401);

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

  // Heartbeat sweep — terminate connections that didn't pong since last tick
  const heartbeat = setInterval(() => {
    wss.clients.forEach((ws) => {
      if (!ws.isAlive) return ws.terminate();
      ws.isAlive = false;
      ws.ping();
    });
  }, HEARTBEAT_INTERVAL_MS);

  wss.on("close", () => clearInterval(heartbeat));

  return wss;
}

function extractToken(req: IncomingMessage): string | null {
  const cookies = cookie.parse(req.headers.cookie ?? "");
  if (cookies.access_token) return cookies.access_token;
  const auth = req.headers.authorization;
  return auth?.startsWith("Bearer ") ? auth.slice(7) : null;
}

function rejectUpgrade(socket: Duplex, status: number): void {
  const reason = status === 401 ? "Unauthorized" : "Bad Request";
  socket.write(`HTTP/1.1 ${status} ${reason}\r\n\r\n`);
  socket.destroy();
}
