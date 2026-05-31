import { Worker } from "bullmq";
import { z } from "zod";
import loadEnv, { getEnvConfig } from "./config/env.js";
import {
  connectPostgres,
  disconnectPostgres,
} from "./lib/db/postgres/client.js";
import { connectRedis, disconnectRedis } from "./lib/cache/redis/client.js";
import { connectMongo, disconnectMongo } from "./lib/db/mongo/client.js";
import { receiveMessages, deleteMessage } from "./lib/aws/sqs.js";
import { jobRegistry } from "./jobs/registry.js";
import { sleep } from "./shared/utils/common.js";
import logger from "./utils/logger.js";
import { unexpectedErrorHandler } from "./utils/unexpectedErrorHandler.js";

process.on("uncaughtException", (err, origin) =>
  unexpectedErrorHandler(err, origin),
);
process.on("unhandledRejection", (reason) =>
  unexpectedErrorHandler(reason, "unhandledRejection"),
);

// SQS messages carry an envelope; BullMQ carries job.name + job.data directly.
const sqsEnvelope = z.object({ type: z.string(), payload: z.unknown() });

// ── boot (lean — no Express, no web startup tasks) ──
await loadEnv();
await connectPostgres();
await connectRedis();
await connectMongo();

const { redis } = getEnvConfig();
const sqsQueueUrl = getEnvConfig().aws.sqs.queues.notifications; // one queue

// ───────────────────────────────────────────────
// 1) BullMQ worker (Redis) — priority / cron / retries
// ───────────────────────────────────────────────
// Pass plain connection OPTIONS (not a shared ioredis instance) — BullMQ then
// creates and owns its own connection (bullWorker.close() cleans it up), and we
// avoid the version mismatch with bullmq's bundled ioredis. maxRetriesPerRequest
// must be null for BullMQ's blocking commands; do NOT reuse getRedis() (sets 1).
const bullConnection = {
  host: redis.host,
  port: redis.port,
  password: redis.password,
  maxRetriesPerRequest: null,
};

const bullWorker = new Worker(
  "default",
  async (job) => {
    const handler = jobRegistry[job.name];
    if (!handler) throw new Error(`No handler for job "${job.name}"`);
    await handler(job.data); // throw → BullMQ retries (attempts/backoff) → failed set
  },
  { connection: bullConnection, concurrency: 5 },
);

bullWorker.on("ready", () => logger.info("BullMQ worker ready"));
bullWorker.on("failed", (job, err) =>
  logger.error(
    { jobId: job?.id, name: job?.name, err: err.message },
    "BullMQ job failed",
  ),
);

// ───────────────────────────────────────────────
// 2) SQS poller (one queue) — durable / external
// ───────────────────────────────────────────────
let sqsRunning = true;
let sqsInFlight = 0;

async function processSqsMessage(
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
  if (msg.receiptHandle) await deleteMessage(sqsQueueUrl, msg.receiptHandle);
}

async function sqsPollLoop(): Promise<void> {
  while (sqsRunning) {
    try {
      const messages = await receiveMessages(sqsQueueUrl); // long-poll (~20s)
      if (!messages.length) continue;
      await Promise.all(
        messages.map(async (msg) => {
          sqsInFlight++;
          try {
            await processSqsMessage(msg);
          } catch (err) {
            logger.error(
              { err, messageId: msg.messageId },
              "SQS job failed — retry/DLQ",
            );
          } finally {
            sqsInFlight--;
          }
        }),
      );
    } catch (err) {
      logger.error({ err }, "SQS receive failed — backing off");
      await sleep(2000); // a broken queue must not hot-loop
    }
  }
}

void sqsPollLoop();
logger.info("Worker started (BullMQ + SQS)");

// ───────────────────────────────────────────────
// graceful shutdown — both (dumb-init forwards SIGTERM here)
// ───────────────────────────────────────────────
let isShuttingDown = false;

async function shutdown(signal: NodeJS.Signals): Promise<void> {
  if (isShuttingDown) return;
  isShuttingDown = true;
  logger.info({ signal }, "Worker shutting down — draining BullMQ + SQS");

  sqsRunning = false; // stop pulling new SQS messages
  await bullWorker.close(); // BullMQ: stop + let active jobs finish

  // wait for in-flight SQS messages (capped so we don't hang)
  const deadline = 20_000;
  const start = process.hrtime.bigint();
  while (sqsInFlight > 0) {
    if (Number(process.hrtime.bigint() - start) / 1e6 > deadline) {
      logger.warn({ sqsInFlight }, "SQS drain timeout — exiting");
      break;
    }
    await sleep(200);
  }

  try {
    await disconnectPostgres();
    await disconnectRedis();
    await disconnectMongo();
    logger.info("Worker stopped");
  } catch (err) {
    logger.error({ err }, "Error during worker teardown");
  } finally {
    process.exit(0);
  }
}

["SIGTERM", "SIGINT"].forEach((signal) =>
  process.on(signal, () => void shutdown(signal as NodeJS.Signals)),
);
