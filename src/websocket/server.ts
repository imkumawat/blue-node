import { WebSocketServer } from "ws";
import type { WebSocket, RawData } from "ws";
import type { Server } from "http";
import type { IncomingMessage } from "http";
import type { Duplex } from "stream";
import cookie from "cookie";
import { v7 as uuidv7 } from "uuid";
import { verifyToken } from "../modules/auth/index.js";
import type { AuthUser } from "../modules/auth/index.js";
import {
  addUserConnection,
  removeUserConnection,
  hasLocalUser,
  connectionCount,
  addPublicConnection,
  removePublicConnection,
  sendToSocket,
} from "./connectionManager.js";
import { subscribeUser, unsubscribeUser } from "./subscriber.js";
import { WS_CLOSE_AUTH_EXPIRED } from "./protocol.js";
import { routeMessage } from "./messageRouter.js";
import logger from "../utils/logger.js";
import { getEnvConfig } from "../config/env.js";

/**
 * Attaches a WebSocket server to the existing httpServer. Auth happens during
 * the HTTP-to-WS upgrade handshake (before accept) — same JWT cookie/Bearer
 * flow as REST/GraphQL via `verifyToken` application use case.
 *
 * Returns the WebSocketServer instance so server.ts can manage shutdown.
 */
export function attachWebSocketServer(httpServer: Server): WebSocketServer {
  const { ws: wsConfig, jwt, cors } = getEnvConfig();

  // The WebSocketServer is created with `noServer: true` so it doesn't listen on its own port — it piggybacks on the existing HTTP server.
  // The `maxPayload` option is set to limit the size of incoming messages, preventing potential abuse or resource exhaustion.
  const wss = new WebSocketServer({
    noServer: true,
    maxPayload: wsConfig.maxPayloadBytes,
  });

  // Handle the HTTP upgrade requests to WebSocket connections.
  // This is where we perform authentication and authorization checks before establishing a WebSocket connection.
  httpServer.on("upgrade", (req, socket, head) => {
    preflightUpgrade(req, socket, () => void handleUpgrade(req, socket, head));
  });

  function preflightUpgrade(
    req: IncomingMessage,
    socket: Duplex,
    next: () => void,
  ): void {
    const url = new URL(req.url ?? "", `http://${req.headers.host}`);
    const knownPaths: string[] = Object.values(wsConfig.paths);
    if (!knownPaths.includes(url.pathname)) {
      socket.destroy();
      return;
    }
    req.pathname = url.pathname; // attach the parsed pathname to the request for later use

    // CSWSH defense: the WS upgrade is NOT subject to CORS, and a browser
    // attaches cookies automatically on a cross-origin handshake — so a
    // malicious page could open an authenticated socket as the victim.
    // Validate Origin against the same allowlist as REST/GraphQL CORS.
    const allowedOrigins = cors.allowedOrigins.split(",").map((o) => o.trim());
    const origin = req.headers.origin;
    if (origin && !allowedOrigins.includes(origin)) {
      return rejectUpgrade(socket, 403);
    }

    // Shed load before the auth handshake: a full instance rejects new sockets
    // so it can't OOM. Clients retry → ALB routes to a less-loaded instance.
    if (connectionCount() >= wsConfig.maxConnections) {
      return rejectUpgrade(socket, 503);
    }

    // TODO: per-IP upgrade rate-limit (Redis) — bound connection churn (CPU).
    next();
  }

  async function handleUpgrade(
    req: IncomingMessage,
    socket: Duplex,
    head: Buffer,
  ): Promise<void> {
    try {
      if (req.pathname === wsConfig.paths.authenticated) {
        const { token: accessToken, viaCookie } = extractToken(req);
        if (!accessToken) return rejectUpgrade(socket, 401);

        // A browser always sends Origin, so a cookie-authenticated upgrade with
        // no Origin is anomalous → reject. Bearer tokens can't be set cross-site
        // by a browser, so native/non-browser clients (which omit Origin) stay
        // allowed.
        if (viaCookie && !req.headers.origin) return rejectUpgrade(socket, 403);

        const user = await verifyToken(accessToken, jwt.userAudience);

        wss.handleUpgrade(req, socket, head, (ws) => {
          handleConnection(ws, user);
        });
      } else if (req.pathname === wsConfig.paths.public) {
        // Public WS: no authenticated user → pass null. handleConnection skips
        // the per-user identity/channel/expiry and registers it as public.
        wss.handleUpgrade(req, socket, head, (ws) =>
          handleConnection(ws, null),
        );
      } else {
        return rejectUpgrade(socket, 404);
      }
    } catch (err) {
      logger.warn({ err }, "WS upgrade failed");
      rejectUpgrade(socket, 401);
    }
  }

  function handleConnection(ws: WebSocket, user: AuthUser | null): void {
    ws.connectionId = uuidv7();

    if (user) {
      // Authenticated: identity + cross-instance channel + token-expiry close.
      // Set identities BEFORE addUserConnection so a pub/sub message arriving the
      // instant we subscribe can already filter on sessionId.
      ws.userId = user.id;
      ws.sessionId = user.sessionId;
      ws.userExp = user.exp;

      const isFirstLocalSocket = !hasLocalUser(user.id);
      addUserConnection(user.id, ws);
      // Subscribe to this user's cross-instance channel on their first local
      // socket; the last socket's close unsubscribes (see ws "close" below).
      if (isFirstLocalSocket) {
        void subscribeUser(user.id).catch((err) =>
          logger.error({ err, userId: user.id }, "WS subscribe failed"),
        );
      }
      logger.info(
        {
          userId: user.id,
          sessionId: user.sessionId,
          connectionId: ws.connectionId,
        },
        "WS connected",
      );
    } else {
      // Public: no identity, no per-user channel, no token-expiry close.
      addPublicConnection(ws);
      logger.info({ connectionId: ws.connectionId }, "Public WS connected");
    }

    // connection logic: ping/pong heartbeat to detect dead connections. The client must respond
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
          logger.warn({ err, userId: user?.id }, "WS message handling failed");
          sendToSocket(ws, { type: "error", data: { message: "Bad message" } });
        }
      })();
    });

    ws.on("close", () => {
      if (user) {
        removeUserConnection(user.id, ws);
        // Last local socket for this user gone → drop the channel subscription.
        if (!hasLocalUser(user.id)) {
          void unsubscribeUser(user.id).catch((err) =>
            logger.error({ err, userId: user.id }, "WS unsubscribe failed"),
          );
        }
        logger.info({ userId: user.id }, "WS disconnected");
      } else {
        removePublicConnection(ws);
        logger.info(
          { connectionId: ws.connectionId },
          "Public WS disconnected",
        );
      }
    });

    ws.on("error", (err) => {
      logger.error({ err, userId: user?.id }, "WS error");
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
  }, wsConfig.heartbeatIntervalMs);

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
        : status === 404
          ? "Not Found"
          : status === 503
            ? "Service Unavailable"
            : "Bad Request";
  socket.write(`HTTP/1.1 ${status} ${reason}\r\n\r\n`);
  socket.destroy();
}
