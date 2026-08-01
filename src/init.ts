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
import {
  initJoseKeys,
  resetJoseKeys,
  getActiveKid,
} from "./shared/utils/jose.js";
import logger from "./utils/logger.js";

export interface CoreServices {
  config: AppConfig;
  teardown: () => Promise<void>;
}

/**
 * Initialize core services shared by EVERY entry point (web + worker):
 * env, JWT signing keys, Postgres, Redis, Mongo, MQTT. Express-free on purpose
 * — the worker must not pull in the HTTP stack. Returns the loaded config + a
 * teardown that disconnects everything.
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
  logger.info(
    "Initializing core services (env, JWT keys, Postgres, Redis, Mongo, MQTT)",
  );
  const config = await loadEnv(overrideConfig);

  // Before any I/O. Importing the keys is pure crypto, so a bad key config
  // fails here in milliseconds — rather than after Postgres, Redis and Mongo
  // connections have been opened and would then have to be torn down again.
  await initJoseKeys(config.jwt.signingKeys, config.jwt.alg);
  logger.info(
    {
      kid: getActiveKid(),
      alg: config.jwt.alg,
      keyCount: config.jwt.signingKeys.length,
    },
    "JWT signing keys loaded",
  );

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
    resetJoseKeys(); // in-memory only — reset so a re-init (tests) starts clean
  };

  return { config, teardown };
}
