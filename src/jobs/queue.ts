import { Queue } from "bullmq";
import { JOB_QUEUE, bullConnection } from "./bullmq.js";
import logger from "../utils/logger.js";

let _queue: Queue | undefined;

/**
 * Initialize the producer-side Queue (web process enqueues jobs through it).
 * defaultJobOptions apply to every job unless overridden per `add()`.
 */
export function initJobQueue(): void {
  _queue = new Queue(JOB_QUEUE, {
    connection: bullConnection(),
    defaultJobOptions: {
      attempts: 3,
      backoff: { type: "exponential", delay: 1000 },
      removeOnComplete: { age: 3600, count: 1000 }, // keep 1h or last 1000
      removeOnFail: { age: 86400 }, // keep failures 1 day for inspection
    },
  });
  logger.info("Job queue initialized");
}

/**
 * Returns the producer Queue. Throws if `initJobQueue()` hasn't run.
 * Use this to enqueue: `getJobQueue().add(name, data, opts)`.
 */
export function getJobQueue(): Queue {
  if (!_queue) {
    throw new Error("Job queue not initialized. Call initJobQueue() first.");
  }
  return _queue;
}

export async function closeJobQueue(): Promise<void> {
  try {
    await _queue?.close();
  } catch (err) {
    logger.warn(
      { err: err instanceof Error ? err.message : String(err) },
      "Job queue close() failed during shutdown",
    );
  }
  _queue = undefined;
  logger.info("Job queue closed");
}
