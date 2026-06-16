import { Worker } from "bullmq";
import { dispatchJob } from "../jobs/dispatch.js";
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
      // job.id is stable across retries → dispatchJob skips a redelivery that
      // already completed. throw → BullMQ retries (attempts/backoff) → failed set.
      await dispatchJob(job.name, job.data, job.id);
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
