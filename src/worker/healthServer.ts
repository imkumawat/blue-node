import { createServer, type Server } from "http";
import { serviceState } from "../utils/serviceState.js";
import logger from "../utils/logger.js";

/**
 * Minimal HTTP server exposing ONLY GET /health — for the Fargate/ECS container
 * health check (a worker has no Express / API surface). Reports the same
 * serviceState the worker's core connections keep updated. NOT a general API.
 */
export function startHealthServer(port: number): Server {
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
    logger.info({ port }, "Worker health server listening"),
  );
  return server;
}
