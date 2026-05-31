import loadEnv from "./config/env.js";
import type { AppConfig } from "./config/env.js";
import type { Express } from "express";
import {
  connectPostgres,
  disconnectPostgres,
} from "./lib/db/postgres/client.js";
import { connectRedis, disconnectRedis } from "./lib/cache/redis/client.js";
import { connectMongo, disconnectMongo } from "./lib/db/mongo/client.js";
import { runStartupTasks } from "./startup/index.js";
import { buildApp } from "./app.js";

interface BootOptions {
  config?: AppConfig;
  runStartup?: boolean;
}

interface BootResult {
  app: Express;
  config: AppConfig;
  teardown: () => Promise<void>;
}

/**
 * Orchestrates the full app boot — env, DB, Redis, startup tasks, app construction.
 * Returns { app, config, teardown } so callers (server.ts OR tests) can use the
 * app without re-implementing the boot sequence.
 *
 * Production:  bootApp()                                    — reads env, full boot
 * Tests:       bootApp({ config: testConfig, runStartup })  — skips env reading
 */
export async function bootApp({
  config: overrideConfig,
  runStartup = true,
}: BootOptions = {}): Promise<BootResult> {
  const config = await loadEnv(overrideConfig);

  await connectPostgres();
  await connectRedis();
  await connectMongo();

  if (runStartup) {
    await runStartupTasks();
  }

  const app = await buildApp();

  const teardown = async (): Promise<void> => {
    await disconnectPostgres();
    await disconnectRedis();
    await disconnectMongo();
  };

  return { app, config, teardown };
}
