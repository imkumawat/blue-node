import { unexpectedErrorHandler } from "./utils/unexpectedErrorHandler.js";

process.on("uncaughtException", (err, origin) =>
  unexpectedErrorHandler(err, origin),
);
process.on("unhandledRejection", (reason) =>
  unexpectedErrorHandler(reason, "unhandledRejection"),
);

import { initCoreServices } from "./init.js";
import { createBullWorker } from "./worker/bullmqWorker.js";
import { createSqsPoller } from "./worker/sqsPoller.js";
import { startHealthServer } from "./worker/healthServer.js";
import logger from "./utils/logger.js";

const { config, teardown } = await initCoreServices();

const health = startHealthServer(config.server.workerPort);
const bull = createBullWorker();
const sqs = createSqsPoller(config.aws.sqs.queues.notifications);
sqs.start();

logger.info("Worker started (BullMQ + SQS)");

let isShuttingDown = false;

async function shutdown(signal: NodeJS.Signals): Promise<void> {
  if (isShuttingDown) return;
  isShuttingDown = true;
  logger.info({ signal }, "Worker shutting down — draining BullMQ + SQS");

  // Hard safety — exit even if a drain/teardown hangs (Fargate SIGKILLs at 30s)
  setTimeout(() => {
    logger.warn("Forced worker exit after shutdown timeout");
    process.exit(1);
  }, 25_000);

  health.close(); // stop accepting health probes
  // SQS poller and BullMQ worker are independent — drain them in parallel
  // (shutdown time = the slower of the two, not their sum).
  await Promise.all([
    sqs.stop(), // stop polling + drain in-flight
    bull.close(), // drain BullMQ active jobs
  ]);

  try {
    await teardown(); // disconnect Postgres / Redis / Mongo
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
