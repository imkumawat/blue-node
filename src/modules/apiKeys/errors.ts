import { HttpError } from "../../shared/errors/HttpError.js";
import { StatusCodes } from "http-status-codes";

export class ApiKeyNotFoundError extends HttpError {
  constructor() {
    super("API_KEY_NOT_FOUND", StatusCodes.NOT_FOUND, "API key not found");
  }
}

export class ApiKeyRevokedError extends HttpError {
  constructor() {
    super(
      "API_KEY_REVOKED",
      StatusCodes.UNAUTHORIZED,
      "API key has been revoked",
    );
  }
}

export class ApiKeyExpiredError extends HttpError {
  constructor() {
    super("API_KEY_EXPIRED", StatusCodes.UNAUTHORIZED, "API key has expired");
  }
}
