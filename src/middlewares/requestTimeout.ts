import type { RequestHandler } from "express";
import { RequestTimeoutError } from "../shared/errors/RequestTimeoutError.js";

/**
 * Per-route timeout middleware (opt-in). Applies when an explicit cap is needed —
 * e.g. routes that hit external APIs, do heavy aggregation, or accept large uploads.
 *
 * NOT applied globally. Use intentionally where bounded wait time matters.
 *
 * NOTE: Does NOT cancel the running handler — it sends the timeout response while
 * the handler continues in background. For true cancellation, wire AbortController
 * through to underlying DB/HTTP clients (Drizzle/Redis/AWS SDK all support signals).
 *
 * Usage:
 *   router.post("/upload", requestTimeout(30_000), uploadHandler);
 *   router.get("/report",  requestTimeout(5_000),  reportHandler);
 */
export function requestTimeout(ms: number): RequestHandler {
  return (_req, res, next) => {
    const timer = setTimeout(() => {
      if (!res.headersSent) {
        next(new RequestTimeoutError(ms));
      }
    }, ms);

    res.on("finish", () => clearTimeout(timer));
    res.on("close", () => clearTimeout(timer));

    next();
  };
}
