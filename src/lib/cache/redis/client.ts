import { Redis } from "ioredis";
import { getEnvConfig } from "../../../config/env.js";
import { serviceState } from "../../../utils/serviceState.js";
import logger from "../../../utils/logger.js";

let _redis: Redis | undefined;
let initialConnected = false;

export async function connectRedis(): Promise<void> {
  const {
    host,
    port,
    password,
    retryBaseMs,
    retryMaxMs,
    connectTimeoutMs,
    commandTimeoutMs,
    keepAliveMs,
  } = getEnvConfig().redis;

  _redis = new Redis({
    host,
    port,
    password,
    maxRetriesPerRequest: 1,
    connectTimeout: connectTimeoutMs,
    commandTimeout: commandTimeoutMs,
    keepAlive: keepAliveMs,
    retryStrategy: (times: number) => {
      if (!initialConnected) return null;
      return Math.min(times * retryBaseMs, retryMaxMs);
    },
  });

  _redis.on("ready", () => {
    serviceState.redis = true;
    if (initialConnected) logger.info("Redis reconnected");
  });

  _redis.on("error", (err: Error) => {
    serviceState.redis = false;
    logger.error({ err: err.message }, "Redis error");
  });

  try {
    await _redis.ping();
    initialConnected = true;
    serviceState.redis = true;
    logger.info("Redis connected");
  } catch (err) {
    logger.fatal(
      { err: err instanceof Error ? err.message : String(err) },
      "Failed to connect to Redis",
    );
    process.exit(1);
  }
}

export async function disconnectRedis(): Promise<void> {
  try {
    await _redis?.quit();
  } catch (err) {
    logger.warn(
      { err: err instanceof Error ? err.message : String(err) },
      "Redis quit() failed during shutdown",
    );
  }
  _redis = undefined;
  logger.info("Redis disconnected");
}

/**
 * Returns the Redis client. Throws if `connectRedis()` hasn't run.
 * Use this instead of importing a module-level `redis` directly — safer
 * because runtime errors are explicit, and easier to mock in tests.
 */
export function getRedis(): Redis {
  if (!_redis) {
    throw new Error("Redis not connected. Call connectRedis() first.");
  }
  return _redis;
}
