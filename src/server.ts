import { createServer } from "http";
import { bootApp } from "./init.js";
import { attachWebSocketServer } from "./websocket/server.js";
import logger from "./utils/logger.js";
import { unexpectedErrorHandler } from "./utils/unexpectedErrorHandler.js";

process.on("uncaughtException", (err, origin) =>
  unexpectedErrorHandler(err, origin),
);
process.on("unhandledRejection", (reason) =>
  unexpectedErrorHandler(reason, "unhandledRejection"),
);

const { app, config, teardown } = await bootApp();
const httpServer = createServer(app);

const wss = attachWebSocketServer(httpServer, config);

// Upstream proxy chain: Cloudflare (100s) → ALB (120s) → Node (125s)
// keepAliveTimeout must be > ALB idle timeout (120s) so ALB never hits a closed
// connection on Node side — prevents 502s. Cloudflare closes first (100s),
// ALB second (120s), Node last (125s) — cleanest shutdown order.
httpServer.keepAliveTimeout = 125_000;

// headersTimeout must be > keepAliveTimeout — Node internal constraint:
// TCP (keepAlive) should close before HTTP (headers) timer fires.
httpServer.headersTimeout = 185_000; // keepAlive (125s) + 60s header window

httpServer.listen(config.server.port, () => {
  logger.info({ port: config.server.port, env: config.env }, "Server running");
});

function shutdown(signal: NodeJS.Signals): void {
  logger.info({ signal }, "Shutdown signal received, draining");

  // 1. Close WS clients (code 1001 — "going away" — so they can reconnect to another instance)
  for (const ws of wss.clients) {
    if (ws.readyState === ws.OPEN) ws.close(1001, "Server shutting down");
  }
  wss.close();

  // 2. Drop idle keep-alive connections FIRST so they can't be reused for a
  // new request once the current one finishes.
  httpServer.closeIdleConnections();

  // 3. Stop accepting new connections. Active requests drain naturally; once
  // they all finish, the callback fires and teardown runs.
  // NOTE: On Windows the OS terminates the process right after this synchronous
  // handler returns, so async teardown may not finish on Ctrl+C — a Windows-only
  // quirk. On Linux/SIGTERM (e.g. Fargate) it completes normally.
  httpServer.close(() => {
    void (async () => {
      try {
        await teardown();
        logger.info("Server closed");
      } catch (err) {
        logger.error({ err }, "Error during shutdown");
      } finally {
        process.exit(0);
      }
    })();
  });

  // 4. Stragglers that don't drain in time: force-close after a grace window so
  // close()'s callback can fire (a stuck socket would otherwise hang it forever).
  setTimeout(() => httpServer.closeAllConnections(), 20_000);

  // 5. Hard safety — exit even if teardown/drain hangs (Fargate SIGKILLs at 30s)
  setTimeout(() => {
    logger.warn("Forced exit after shutdown timeout");
    process.exit(1);
  }, 25_000);
}

// SIGTERM is sent by Fargate when stopping the task, SIGINT is for local development (Ctrl+C)
["SIGTERM", "SIGINT"].forEach((signal) =>
  process.on(signal, () => shutdown(signal as NodeJS.Signals)),
);
