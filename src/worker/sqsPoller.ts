import { z } from "zod";
import { receiveMessages, deleteMessage } from "../lib/aws/sqs.js";
import { jobRegistry } from "../jobs/registry.js";
import { sleep } from "../shared/utils/common.js";
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
 */
export function createSqsPoller(queueUrl: string): SqsPoller {
  let running = false;
  let inFlight = 0;
  let loopPromise: Promise<void> | undefined;

  async function processMessage(
    msg: Awaited<ReturnType<typeof receiveMessages>>[number],
  ): Promise<void> {
    const { type, payload } = sqsEnvelope.parse(msg.body);
    const handler = jobRegistry[type];
    if (!handler) {
      // no delete → visibility timeout → retry → DLQ (never silently drop)
      logger.warn(
        { type, messageId: msg.messageId },
        "No handler — leaving for DLQ",
      );
      return;
    }
    await handler(payload);
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
