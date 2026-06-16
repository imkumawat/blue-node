import { jobRegistry } from "./registry.js";
import { getRedis } from "../lib/cache/redis/client.js";
import { getEnvConfig } from "../config/env.js";
import logger from "../utils/logger.js";

// How long a completed-job marker lives. It must outlast the realistic window
// between a job completing and a redelivery of it being processed — that window
// is minutes (transport recovery / visibility timeout) up to maybe an hour (a
// slow deploy or outage), so 24h is a wide safety margin. A redelivered
// completed job is skipped AND acked on first re-receipt, so markers rarely
// live anywhere near this TTL. Markers are tiny, so memory is a non-issue.
const JOB_DONE_TTL_SEC = 24 * 60 * 60;

/**
 * Single dispatch path for BOTH transports (BullMQ worker + SQS poller) — they
 * route every job through here, so idempotency is STRUCTURAL: any current or
 * future job type is effectively-once by construction, not per-handler.
 *
 * Both transports are at-least-once: a deploy (Fargate kills an in-flight task),
 * autoscale/spot interruption, crash, or a lost ack makes the job run again on
 * redelivery. We mark each job done in Redis AFTER success — keyed by the
 * transport's stable id (BullMQ `job.id` / SQS `messageId`, both survive
 * redelivery) — and skip a redelivered job that already completed.
 *
 * GUARANTEES (and limits — this is effectively-once, NOT exactly-once):
 *  - Routine redelivery after completion (the every-deploy case) → skipped.
 *  - Transient failure before completion → re-runs (the marker is success-only).
 *  - A job is never dropped — only KNOWN completions are skipped.
 *  - Residual duplicate: a crash in the tiny window between the side effect and
 *    the marker, or concurrent double-delivery (the exists→set is not atomic).
 *    A side effect that must be exactly-once (payments/orders) still needs its
 *    own DB-transactional idempotency record — write the marker in the SAME
 *    transaction as the effect. This generic guard cannot provide that.
 */
export async function dispatchJob(
  type: string,
  payload: unknown,
  idempotencyKey: string | undefined,
): Promise<void> {
  const handler = jobRegistry[type];
  if (!handler) throw new Error(`No handler for job "${type}"`);

  // No stable id (rare) → cannot dedup; fall back to plain at-least-once.
  if (!idempotencyKey) {
    await handler(payload);
    return;
  }

  const { jobDone } = getEnvConfig().redis.keys;
  const doneKey = `${jobDone}${idempotencyKey}`;
  const redis = getRedis();

  if (await redis.exists(doneKey)) {
    logger.info({ type, idempotencyKey }, "Job already processed — skipping");
    return;
  }

  await handler(payload);

  // Mark AFTER success so a failed job re-runs rather than being skipped.
  await redis.set(doneKey, "1", "EX", JOB_DONE_TTL_SEC);
}
