import { getEnvConfig } from "../config/env.js";

/**
 * Single source of truth for the queue name — the producer Queue, the Worker,
 * and any QueueEvents listener must all use this exact string to talk to the
 * same queue. Jobs within it are routed by `job.name` via the job registry.
 */
export const JOB_QUEUE = "jobs";

/**
 * Shared BullMQ connection options (used by both the Queue and the Worker).
 *
 * Returns plain OPTIONS (not a shared ioredis instance) so BullMQ owns its own
 * connection — avoids the version clash with bullmq's bundled ioredis.
 * `maxRetriesPerRequest: null` is required for BullMQ's blocking commands.
 * Uses `bullRedis` (separate, must be noeviction in prod) — NOT the cache Redis,
 * whose eviction policy would silently drop queued jobs.
 */
export function bullConnection() {
  const { bullRedis } = getEnvConfig();
  return {
    host: bullRedis.host,
    port: bullRedis.port,
    password: bullRedis.password,
    maxRetriesPerRequest: null,
  };
}
