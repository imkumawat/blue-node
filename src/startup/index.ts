import { checkServices } from "./checkServices.js";
import { checkScopes } from "./checkScopes.js";
import { warmCache } from "./warmCache.js";
import logger from "../utils/logger.js";

interface Job {
  name: string;
  fn: () => Promise<void>;
  critical: boolean;
}

const jobs: Job[] = [
  { name: "checkServices", fn: checkServices, critical: true },
  { name: "checkScopes", fn: checkScopes, critical: true },
  { name: "warmCache", fn: warmCache, critical: true },
];

export async function runStartupTasks(): Promise<void> {
  await jobs.reduce(async (prev, job) => {
    await prev;
    try {
      await job.fn();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (job.critical) {
        logger.fatal({ err: message }, `${job.name} failed — aborting startup`);
        process.exit(1);
      }
      logger.warn({ err: message }, `${job.name} failed — continuing startup`);
    }
  }, Promise.resolve());
}
