import { StatusCodes } from "http-status-codes";
import { HttpError } from "./HttpError.js";

/**
 * Generic 404 — use for unmatched routes (catch-all in app.ts) or any
 * "resource does not exist" case that isn't covered by a domain-specific
 * error (e.g. UserNotFoundError).
 */
export class NotFoundError extends HttpError {
  constructor(message = "Resource not found") {
    super("NOT_FOUND", StatusCodes.NOT_FOUND, message);
  }
}
