import { z } from "zod";
import {
  receiveMessages,
  deleteMessage,
  extendVisibility,
} from "../lib/aws/sqs.js";
import { jobRegistry } from "../jobs/registry.js";
import { sleep } from "../shared/utils/common.js";
import { getEnvConfig } from "../config/env.js";
import logger from "../utils/logger.js";

// SQS messages carry an envelope; the `type` keys into the shared job registry.
const sqsEnvelope = z.object({ type: z.string(), payload: z.unknown() });

export interface SqsPoller {
  start: () => void;
  stop: () => Promise<void>;
}

/**
 * Poll one SQS queue, dispatch each message via the shared job registry.
 * Long-polls; deletes ONLY on success (failures retry via visibility timeout
 * → DLQ). `stop()` halts polling and drains in-flight messages (capped).
 *
 * INFRA DEPENDENCY: "→ DLQ" assumes the queue has an AWS-side redrive policy
 * (maxReceiveCount + deadLetterTargetArn) configured in IaC/console. Without it
 * a permanently-failing message redelivers until SQS message retention expires
 * (~4d) instead of landing in a DLQ — this code only ever skips the delete; SQS
 * owns the retry-count → DLQ move.
 *
 * Suggested: maxReceiveCount = 5 with the 30s visibility timeout → ~5 retries
 * over ~2.5 min before DLQ (enough to ride out transient downstream blips
 * without parking a poison message too long). SQS has no native per-message
 * backoff — each retry is one fixed visibility-timeout apart. Tune up only if
 * downstream recovery is slow; tune down for mostly-permanent failures.
 */
export function createSqsPoller(queueUrl: string): SqsPoller {
  let running = false;
  let inFlight = 0;
  let loopPromise: Promise<void> | undefined;

  const { visibilityTimeout } = getEnvConfig().aws.sqs;
  // Refresh at half the window so a slow handler keeps the message hidden well
  // before SQS would otherwise redeliver it (→ concurrent double-processing).
  const heartbeatIntervalMs = Math.floor((visibilityTimeout / 2) * 1000);

  function startVisibilityHeartbeat(receiptHandle: string): () => void {
    const timer = setInterval(() => {
      void extendVisibility(queueUrl, receiptHandle, visibilityTimeout).catch(
        (err) => logger.warn({ err, queueUrl }, "SQS visibility extend failed"),
      );
    }, heartbeatIntervalMs);
    return () => clearInterval(timer);
  }

  async function processMessage(
    msg: Awaited<ReturnType<typeof receiveMessages>>[number],
  ): Promise<void> {
    let parsed: unknown;
    try {
      parsed = JSON.parse(msg.body);
    } catch {
      // Re-throw WITHOUT the body: a JSON SyntaxError embeds an input snippet
      // (potential PII) in its message. This runs inside the per-message try in
      // loop(), so a malformed body fails only this message (→ visibility
      // timeout → DLQ) instead of aborting the whole batch, and never leaks.
      throw new Error("malformed JSON body");
    }
    const { type, payload } = sqsEnvelope.parse(parsed);
    const handler = jobRegistry[type];
    if (!handler) {
      // no delete → visibility timeout → retry → DLQ (never silently drop)
      logger.warn(
        { type, messageId: msg.messageId },
        "No handler — leaving for DLQ",
      );
      return;
    }
    // Keep the message hidden while the handler runs: without this, a handler
    // slower than the visibility timeout lets SQS redeliver to another worker →
    // concurrent double-processing. The heartbeat resets the timeout at
    // half-window; finally clears it whether the handler succeeds or throws.
    const stopHeartbeat = msg.receiptHandle
      ? startVisibilityHeartbeat(msg.receiptHandle)
      : undefined;
    try {
      await handler(payload);
    } finally {
      stopHeartbeat?.();
    }
    // delete ONLY on success; throw → message reappears → retry → DLQ
    if (msg.receiptHandle) await deleteMessage(queueUrl, msg.receiptHandle);
  }

  async function loop(): Promise<void> {
    while (running) {
      try {
        const messages = await receiveMessages(queueUrl); // long-poll (~20s)
        if (!messages.length) continue;
        await Promise.all(
          messages.map(async (msg) => {
            inFlight++;
            try {
              await processMessage(msg);
            } catch (err) {
              logger.error(
                { err, messageId: msg.messageId },
                "SQS job failed — retry/DLQ",
              );
            } finally {
              inFlight--;
            }
          }),
        );
      } catch (err) {
        logger.error({ err }, "SQS receive failed — backing off");
        await sleep(2000); // a broken queue must not hot-loop
      }
    }
  }

  return {
    start() {
      if (running) return;
      running = true;
      loopPromise = loop();
      logger.info({ queueUrl }, "SQS poller started");
    },
    async stop() {
      running = false; // loop exits after the current long-poll returns

      // wait for in-flight message handlers to settle (capped)
      const deadline = 20_000;
      const start = process.hrtime.bigint();
      while (inFlight > 0) {
        if (Number(process.hrtime.bigint() - start) / 1e6 > deadline) {
          logger.warn({ inFlight }, "SQS drain timeout — exiting");
          break;
        }
        await sleep(200);
      }
      await loopPromise; // let the loop fully unwind
      logger.info("SQS poller stopped");
    },
  };
}
