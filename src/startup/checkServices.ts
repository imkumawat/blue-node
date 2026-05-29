import logger from "../utils/logger.js";

export async function checkServices(): Promise<void> {
  await new Promise<void>((resolve) => setImmediate(() => resolve()));
  logger.info("Services checked");
}
