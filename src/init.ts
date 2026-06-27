import loadEnv from "./config/env.js";
import type { AppConfig } from "./config/env.js";
import {
  connectPostgres,
  disconnectPostgres,
} from "./lib/db/postgres/client.js";
import { connectRedis, disconnectRedis } from "./lib/cache/redis/client.js";
import { connectMongo, disconnectMongo } from "./lib/db/mongo/client.js";
import { connectMqtt, disconnectMqtt } from "./lib/mqtt/client.js";
import { initJobQueue, closeJobQueue } from "./jobs/queue.js";
import logger from "./utils/logger.js";

export interface CoreServices {
  config: AppConfig;
  teardown: () => Promise<void>;
}

/**
 * Initialize core services shared by EVERY entry point (web + worker):
 * env, Postgres, Redis, Mongo, MQTT. Express-free on purpose — the worker must
 * not pull in the HTTP stack. Returns the loaded config + a teardown that
 * disconnects everything.
 *
 * NOTE: MQTT is shared infra (web publishes, worker subscribes) so it lives
 * here, but it is NON-CORE in failure terms — a broker outage must NOT take the
 * app down. connectMqtt() therefore degrades gracefully (no process.exit) and
 * is absent from serviceState (no 503 gate). Only Postgres/Redis/Mongo hard-exit.
 *
 * Web:    bootApp() wraps this with startup tasks + Express.
 * Worker: worker.ts uses this directly, then attaches its transports.
 * Tests:  pass overrideConfig to skip env reading.
 */
export async function initCoreServices(
  overrideConfig?: AppConfig,
): Promise<CoreServices> {
  logger.info("Initializing core services (env, Postgres, Redis, Mongo, MQTT)");
  const config = await loadEnv(overrideConfig);

  await connectPostgres();
  await connectRedis();
  await connectMongo();
  await connectMqtt(); // shared feature transport (delivery + device events); NON-CORE — graceful if broker down, not in serviceState
  initJobQueue(); // BullMQ producer — both web and worker can enqueue

  const teardown = async (): Promise<void> => {
    await closeJobQueue(); // close queue before datastores
    await disconnectMqtt(); // close broker client before datastores
    await disconnectPostgres();
    await disconnectRedis();
    await disconnectMongo();
  };

  return { config, teardown };
}
