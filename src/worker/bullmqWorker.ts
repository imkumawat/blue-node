import { Worker } from "bullmq";
import { getEnvConfig } from "../config/env.js";
import { jobRegistry } from "../jobs/registry.js";
import logger from "../utils/logger.js";

/**
 * Create the BullMQ worker (Redis-backed jobs — priority, retries, scheduled).
 *
 * Pass plain connection OPTIONS (not a shared ioredis instance) so BullMQ owns
 * its connection (worker.close() cleans it up) and we avoid the version clash
 * with bullmq's bundled ioredis. maxRetriesPerRequest must be null for BullMQ's
 * blocking commands; do NOT reuse getRedis() (it sets 1).
 */
export function createBullWorker(): Worker {
  const { redis } = getEnvConfig();

  const worker = new Worker(
    "default",
    async (job) => {
      const handler = jobRegistry[job.name];
      if (!handler) throw new Error(`No handler for job "${job.name}"`);
      await handler(job.data); // throw → BullMQ retries (attempts/backoff) → failed set
    },
    {
      connection: {
        host: redis.host,
        port: redis.port,
        password: redis.password,
        maxRetriesPerRequest: null,
      },
      concurrency: 5,
    },
  );

  worker.on("ready", () => logger.info("BullMQ worker ready"));
  worker.on("failed", (job, err) =>
    logger.error(
      { jobId: job?.id, name: job?.name, err: err.message },
      "BullMQ job failed",
    ),
  );

  return worker;
}
