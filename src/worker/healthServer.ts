import { createServer, type Server } from "http";
import { serviceState } from "../utils/serviceState.js";
import logger from "../utils/logger.js";

/**
 * Minimal HTTP server exposing ONLY GET /health — for the Fargate/ECS container
 * health check of the non-web processes (worker, cron), which have no Express /
 * API surface. Reports the same serviceState their core connections keep
 * updated. NOT a general API. `label` only tags the startup log line.
 */
export function startHealthServer(port: number, label = "Worker"): Server {
  const server = createServer((req, res) => {
    if (req.method === "GET" && req.url === "/health") {
      const healthy =
        serviceState.postgres && serviceState.redis && serviceState.mongo;
      res.writeHead(healthy ? 200 : 503, {
        "Content-Type": "application/json",
      });
      res.end(
        JSON.stringify({
          status: healthy ? "ok" : "degraded",
          services: serviceState,
        }),
      );
      return;
    }
    res.writeHead(404).end();
  });

  server.listen(port, () =>
    logger.info({ port }, `${label} health server listening`),
  );
  return server;
}
