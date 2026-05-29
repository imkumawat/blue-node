import { HttpError } from "./HttpError.js";

export class RequestTimeoutError extends HttpError {
  constructor(timeoutMs: number) {
    super(
      "REQUEST_TIMEOUT",
      503,
      `Request exceeded maximum allowed time of ${timeoutMs}ms`,
      { timeoutMs },
    );
  }
}
