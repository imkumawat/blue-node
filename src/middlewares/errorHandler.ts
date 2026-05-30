import type { Request, Response, NextFunction } from "express";
import { StatusCodes } from "http-status-codes";
import { HttpError } from "../shared/errors/HttpError.js";
import { ERROR_MESSAGES } from "../shared/constants/errors.js";
import { getEnvConfig } from "../config/env.js";
import logger from "../utils/logger.js";

interface BodyParserError {
  type?: string;
  status?: number;
  message?: string;
  stack?: string;
}

function withStack(err: { stack?: string }): { error_stack?: string } {
  const { env } = getEnvConfig();
  return env === "development" && err.stack ? { error_stack: err.stack } : {};
}

export default function errorHandler(
  err: unknown,
  req: Request,
  res: Response,
  _next: NextFunction,
): void {
  if (err instanceof HttpError) {
    res.status(err.statusCode).json({
      success: false,
      code: err.code,
      message: err.message,
      ...(err.details ? { errors: err.details } : {}),
      ...withStack(err),
    });
    return;
  }

  const e = err as BodyParserError;

  // body-parser errors
  if (e.type === "entity.parse.failed") {
    res.status(StatusCodes.BAD_REQUEST).json({
      success: false,
      message: ERROR_MESSAGES.INVALID_JSON,
      ...withStack(e),
    });
    return;
  }

  if (e.type === "entity.too.large") {
    res.status(StatusCodes.REQUEST_TOO_LONG).json({
      success: false,
      message: ERROR_MESSAGES.PAYLOAD_TOO_LARGE,
      ...withStack(e),
    });
    return;
  }

  // No generic err.status === 400 catch-all — arbitrary 3rd-party err.message
  // can leak internals (tmp paths, internal IPs, library specifics). Our own
  // code throws HttpError subclasses which the first branch handles. Any
  // genuinely-unknown 400 falls through to the 500 branch below: client gets
  // a sanitized envelope, full error is logged for debugging.

  logger.error({ requestId: req.requestId, err }, "Unhandled error");
  res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({
    success: false,
    message: ERROR_MESSAGES.INTERNAL_SERVER_ERROR,
    ...withStack(e),
  });
}
