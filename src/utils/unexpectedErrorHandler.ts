import logger from "./logger.js";

/**
 * Unified handler for both `uncaughtException` (Error + origin) and
 * `unhandledRejection` (unknown reason). Normalizes the input to Error shape
 * before logging — non-Error rejections (e.g. `Promise.reject("oops")`) still
 * get useful log lines.
 *
 * Wire in server.ts:
 *   process.on("uncaughtException", (err, origin) =>
 *     unexpectedErrorHandler(err, origin),
 *   );
 *   process.on("unhandledRejection", (reason) =>
 *     unexpectedErrorHandler(reason, "unhandledRejection"),
 *   );
 */
export function unexpectedErrorHandler(err: unknown, origin?: string): void {
  const errorObj = err instanceof Error ? err : new Error(String(err));

  logger.fatal(
    {
      err: errorObj.message,
      stack: errorObj.stack,
      origin: origin ?? "unknown",
    },
    "Unexpected error -- shutting down",
  );
  process.exit(1);
}
