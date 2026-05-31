import type { Express } from "express";
import type { AppConfig } from "./config/env.js";
import { initCoreServices } from "./init.js";
import { runStartupTasks } from "./startup/index.js";
import { buildApp } from "./app.js";
import logger from "./utils/logger.js";

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
 * Orchestrates the full WEB boot — core services (via initCoreServices) plus
 * startup tasks and Express app construction. Returns { app, config, teardown }
 * so callers (server.ts OR tests) need not re-implement the sequence.
 *
 * Production:  bootApp()                                    — reads env, full boot
 * Tests:       bootApp({ config: testConfig, runStartup })  — skips env reading
 */
export async function bootApp({
  config: overrideConfig,
  runStartup = true,
}: BootOptions = {}): Promise<BootResult> {
  const { config, teardown } = await initCoreServices(overrideConfig);

  if (runStartup) {
    logger.info("Running startup tasks");
    await runStartupTasks();
  }

  logger.info("Building Express app");
  const app = await buildApp();

  return { app, config, teardown };
}
