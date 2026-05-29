import { Router } from "express";
import type { Request, Response } from "express";
import os from "os";
import { sql } from "drizzle-orm";
import { getDb } from "../lib/db/postgres/client.js";
import { getRedis } from "../lib/cache/redis/client.js";
import { serviceState } from "../utils/serviceState.js";
import { getEnvConfig } from "../config/env.js";

const router = Router();

interface ServiceStatus {
  status: "available" | "unavailable";
  responseTimeMs: number | null;
}

function checkWithTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error("timeout")), ms),
    ),
  ]);
}

async function pingService<T>(
  pingFn: () => Promise<T>,
  timeoutMs: number,
): Promise<ServiceStatus> {
  const start = process.hrtime.bigint();
  try {
    await checkWithTimeout(pingFn(), timeoutMs);
    const ms = Number(process.hrtime.bigint() - start) / 1e6;
    return { status: "available", responseTimeMs: +ms.toFixed(1) };
  } catch {
    return { status: "unavailable", responseTimeMs: null };
  }
}

const mb = (bytes: number): number => +(bytes / 1024 / 1024).toFixed(1);

/**
 * @openapi
 * /health:
 *   get:
 *     summary: Health check
 *     description: Returns server, runtime, memory, and dependency status.
 *     tags:
 *       - Health
 *     responses:
 *       200:
 *         description: Server is healthy
 *       503:
 *         description: Server is degraded
 */
router.get("/health", async (_req: Request, res: Response) => {
  const { timeoutMs } = getEnvConfig().health;
  const { env } = getEnvConfig();

  const [database, redisStatus] = await Promise.all([
    pingService(() => getDb().execute(sql`SELECT 1`), timeoutMs),
    pingService(() => getRedis().ping(), timeoutMs),
  ]);

  serviceState.db = database.status === "available";
  serviceState.redis = redisStatus.status === "available";

  const isHealthy = serviceState.db && serviceState.redis;
  const mem = process.memoryUsage();

  res.status(isHealthy ? 200 : 503).json({
    success: isHealthy,
    status: isHealthy ? "ok" : "degraded",
    message: isHealthy ? "Server is up and running" : "Service unavailable",
    uptime: +process.uptime().toFixed(1),
    timestamp: new Date().toISOString(),
    app: {
      env,
      nodeVersion: process.version,
      platform: process.platform,
      arch: process.arch,
      pid: process.pid,
      hostname: os.hostname(),
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    },
    memory: {
      rssMb: mb(mem.rss),
      heapUsedMb: mb(mem.heapUsed),
      heapTotalMb: mb(mem.heapTotal),
      externalMb: mb(mem.external),
    },
    services: {
      database,
      redis: redisStatus,
    },
  });
});

export default router;
