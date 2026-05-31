import { Worker } from "bullmq";
import { jobRegistry } from "../jobs/registry.js";
import { JOB_QUEUE, bullConnection } from "../jobs/bullmq.js";
import logger from "../utils/logger.js";

/**
 * Create the BullMQ worker (Redis-backed jobs — priority, retries, scheduled).
 * JOB_QUEUE + bullConnection() are shared with the producer Queue (jobs/bullmq.ts)
 * so the queue name and Redis connection never drift between producer and
 * consumer. (bullConnection uses the separate noeviction bullRedis — see there.)
 */
export function createBullWorker(): Worker {
  const worker = new Worker(
    JOB_QUEUE,
    async (job) => {
      const handler = jobRegistry[job.name];
      if (!handler) throw new Error(`No handler for job "${job.name}"`);
      await handler(job.data); // throw → BullMQ retries (attempts/backoff) → failed set
    },
    {
      connection: bullConnection(),
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
