import type { Request, Response, NextFunction } from "express";
import logger from "../utils/logger.js";

/**
 * To trace a single request end-to-end across all log lines it emits.
 *
 * Attaches a per-request child logger to `req.logger`. Auto-binds `requestId`
 * so every log line emitted during this request correlates with the
 * httpLogger boundary log (both share the same requestId).
 *
 * Mount AFTER the `requestId` middleware so `req.requestId` is available.
 *
 * Usage:
 *   - REST handler:        req.logger.info({ event: "x" }, "what happened")
 *   - GraphQL resolver:    ctx.logger.info({ event: "x" }, "what happened")
 *     (buildContext sets ctx.logger = req.logger, so same instance)
 */
export function requestLogger(
  req: Request,
  _res: Response,
  next: NextFunction,
): void {
  req.logger = logger.child({ requestId: req.requestId });
  req.startTime = process.hrtime.bigint();
  next();
}
