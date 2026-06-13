import type { Request, Response, NextFunction } from "express";
import { serviceState } from "../utils/serviceState.js";

// Advisory back-off hint on the 503. Recovery time is unknown, so this is a
// small fixed value — clients/proxies that honor Retry-After back off instead
// of hammering; if still down, the next attempt simply gets another 503.
const RETRY_AFTER_SECONDS = 5;

export default function serviceAvailability(
  _req: Request,
  res: Response,
  next: NextFunction,
): void {
  if (!serviceState.postgres || !serviceState.redis || !serviceState.mongo) {
    res.setHeader("Retry-After", RETRY_AFTER_SECONDS);
    res.status(503).json({
      success: false,
      code: "SERVICE_UNAVAILABLE",
      status: "degraded",
      message:
        "Service is currently unavailable due to database or cache issues. Please try again later.",
    });
    return;
  }
  next();
}
