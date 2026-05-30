import { Router } from "express";
import type { Request, Response, NextFunction } from "express";
import os from "os";
import basicAuth from "express-basic-auth";
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
 * Public /health returns minimal status (ALB-safe, no auth). Add ?detailed=true
 * to include app/memory/runtime info — that branch is basic-auth gated in
 * production. Reuses swagger credentials (same ops-only access pattern).
 * Internal infra fields (nodeVersion, hostname, pid, etc.) are NOT exposed
 * to unauthenticated callers — they enable fingerprinting / CVE targeting.
 */
function detailedAuth(req: Request, res: Response, next: NextFunction): void {
  if (req.query.detailed !== "true") {
    next();
    return;
  }
  const { swagger } = getEnvConfig();

  if (!swagger.user || !swagger.password) {
    res.status(503).json({
      success: false,
      message: "Detailed health auth not configured",
    });
    return;
  }
  basicAuth({
    users: { [swagger.user]: swagger.password },
    challenge: true,
    realm: "Health detailed",
  })(req, res, next);
}

/**
 * @openapi
 * /health:
 *   get:
 *     summary: Health check
 *     description: Returns minimal status + dependency health. Pass `?detailed=true` (basic-auth gated in prod) to include runtime / memory info.
 *     tags:
 *       - Health
 *     parameters:
 *       - in: query
 *         name: detailed
 *         schema:
 *           type: string
 *           enum: ["true"]
 *         required: false
 *         description: When `true`, includes runtime / memory diagnostics (auth required in production).
 *     responses:
 *       200:
 *         description: Server is healthy
 *       503:
 *         description: Server is degraded
 */
router.get("/health", detailedAuth, async (req: Request, res: Response) => {
  const { timeoutMs } = getEnvConfig().health;
  const { env } = getEnvConfig();

  const [database, redisStatus] = await Promise.all([
    pingService(() => getDb().execute(sql`SELECT 1`), timeoutMs),
    pingService(() => getRedis().ping(), timeoutMs),
  ]);

  serviceState.db = database.status === "available";
  serviceState.redis = redisStatus.status === "available";

  const isHealthy = serviceState.db && serviceState.redis;

  const base = {
    success: isHealthy,
    status: isHealthy ? "ok" : "degraded",
    message: isHealthy ? "Server is up and running" : "Service unavailable",
    uptime: +process.uptime().toFixed(1),
    timestamp: new Date().toISOString(),
    services: { database, redis: redisStatus },
  };

  if (req.query.detailed !== "true") {
    res.status(isHealthy ? 200 : 503).json(base);
    return;
  }

  const mem = process.memoryUsage();
  res.status(isHealthy ? 200 : 503).json({
    ...base,
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
  });
});

export default router;
