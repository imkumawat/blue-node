import logger from "./logger.js";

const SHUTDOWN_BACKSTOP_MS = 30_000;
let alreadyTriggered = false;

/**
 * Unified handler for both `uncaughtException` (Error + origin) and
 * `unhandledRejection` (unknown reason). Normalizes the input to Error shape
 * before logging — non-Error rejections (e.g. `Promise.reject("oops")`) still
 * get useful log lines.
 *
 * Instead of `process.exit(1)` directly, emits SIGTERM to trigger the existing
 * graceful shutdown path in server.ts (WS close → idle conn drop → drain →
 * teardown). Prevents abrupt termination that would dangle DB/Redis sockets
 * and 502 in-flight HTTP requests.
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
    "Unexpected error — initiating graceful shutdown",
  );

  // Dedupe: parallel unhandled rejections shouldn't each fire SIGTERM.
  if (alreadyTriggered) return;
  alreadyTriggered = true;

  // Trigger the existing SIGTERM handler in server.ts → graceful shutdown().
  process.kill(process.pid, "SIGTERM");

  // Backstop for early-boot crashes (signal handlers not yet registered) or
  // a stuck shutdown path. shutdown() has its own 25s internal timer; this is
  // layered defense. .unref() so it doesn't keep the event loop alive if the
  // graceful drain finishes first.
  setTimeout(() => {
    logger.fatal("Forced exit — shutdown did not complete in time");
    process.exit(1);
  }, SHUTDOWN_BACKSTOP_MS).unref();
}
