import { MongoClient } from "mongodb";
import type { Db } from "mongodb";
import { getEnvConfig } from "../../../config/env.js";
import { serviceState } from "../../../utils/serviceState.js";
import logger from "../../../utils/logger.js";

let client: MongoClient | undefined;
let _mongoDb: Db | undefined;

export async function connectMongo(): Promise<void> {
  const { uri, db, options } = getEnvConfig().mongo;

  client = new MongoClient(uri, {
    maxPoolSize: options.maxPoolSize,
    minPoolSize: options.minPoolSize,
    serverSelectionTimeoutMS: options.serverSelectionTimeoutMs,
    connectTimeoutMS: options.connectTimeoutMs,
    socketTimeoutMS: options.socketTimeoutMs,
    appName: options.appName,
  });

  client.on("serverHeartbeatSucceeded", () => {
    serviceState.mongo = true;
  });

  client.on("serverHeartbeatFailed", () => {
    serviceState.mongo = false;
  });

  try {
    await client.connect();
    await client.db(db).command({ ping: 1 });
  } catch (err) {
    logger.fatal(
      { err: err instanceof Error ? err.message : String(err) },
      "Failed to connect to MongoDB",
    );
    process.exit(1);
  }

  serviceState.mongo = true;
  _mongoDb = client.db(db);
  logger.info("MongoDB connected");
}

export async function disconnectMongo(): Promise<void> {
  try {
    await client?.close();
  } catch (err) {
    logger.warn(
      { err: err instanceof Error ? err.message : String(err) },
      "MongoDB close() failed during shutdown",
    );
  }
  _mongoDb = undefined;
  logger.info("MongoDB disconnected");
}

/**
 * Returns the Mongo Db handle. Throws if `connectMongo()` hasn't run.
 * Use this instead of importing a module-level db directly — safer at
 * runtime and easier to mock in tests.
 */
export function getMongo(): Db {
  if (!_mongoDb) {
    throw new Error("MongoDB not connected. Call connectMongo() first.");
  }
  return _mongoDb;
}
