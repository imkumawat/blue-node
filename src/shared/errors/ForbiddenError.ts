import { StatusCodes } from "http-status-codes";
import { HttpError } from "./HttpError.js";

export class ForbiddenError extends HttpError {
  constructor(
    message: string = "Insufficient permissions",
    details: unknown = null,
  ) {
    super("FORBIDDEN", StatusCodes.FORBIDDEN, message, details);
  }
}
