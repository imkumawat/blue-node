import { HttpError } from "./HttpError.js";

export class ValidationError extends HttpError {
  constructor(errors: unknown) {
    super("VALIDATION_FAILED", 422, "Validation failed", errors);
  }
}
