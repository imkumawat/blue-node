import { HttpError } from "./HttpError.js";

export class ComplexityLimitError extends HttpError {
  constructor(actual: number, max: number) {
    super(
      "COMPLEXITY_LIMIT_EXCEEDED",
      400,
      `Query complexity ${actual} exceeds maximum allowed ${max}`,
      { actual, max },
    );
  }
}
