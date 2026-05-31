import type { Request, Response, NextFunction } from "express";
import { serviceState } from "../utils/serviceState.js";

export default function serviceAvailability(
  _req: Request,
  res: Response,
  next: NextFunction,
): void {
  if (!serviceState.postgres || !serviceState.redis || !serviceState.mongo) {
    res.status(503).json({
      success: false,
      status: "degraded",
      message:
        "Service is currently unavailable due to database or cache issues. Please try again later.",
    });
    return;
  }
  next();
}
