import { StatusCodes } from "http-status-codes";
import { HttpError } from "./HttpError.js";

export class RateLimitError extends HttpError {
  constructor(retryAfterSeconds: number | null = null) {
    super(
      "RATE_LIMITED",
      StatusCodes.TOO_MANY_REQUESTS,
      "Too many requests, please try again later",
      retryAfterSeconds ? { retryAfterSeconds } : null,
    );
  }
}
