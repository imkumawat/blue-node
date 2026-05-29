import logger from "../utils/logger.js";

export async function warmCache(): Promise<void> {
  await new Promise<void>((resolve) => setImmediate(() => resolve()));
  logger.info("Cache warmed");
}
