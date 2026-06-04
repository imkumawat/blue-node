import { HttpError } from "../../shared/errors/HttpError.js";
import { StatusCodes } from "http-status-codes";

export class EmailAlreadyExistsError extends HttpError {
  constructor() {
    super(
      "EMAIL_ALREADY_EXISTS",
      StatusCodes.CONFLICT,
      "User with this email already exists",
    );
  }
}

export class CaptchaRequiredError extends HttpError {
  constructor() {
    super(
      "CAPTCHA_REQUIRED",
      StatusCodes.FORBIDDEN,
      "Additional verification required — please complete the CAPTCHA.",
    );
  }
}

export class InvalidCredentialsError extends HttpError {
  constructor() {
    super(
      "INVALID_CREDENTIALS",
      StatusCodes.UNAUTHORIZED,
      "Invalid email or password",
    );
  }
}

export class AccountNotActiveError extends HttpError {
  constructor() {
    super("ACCOUNT_NOT_ACTIVE", StatusCodes.FORBIDDEN, "Account is not active");
  }
}

export class InvalidRefreshTokenError extends HttpError {
  constructor() {
    super(
      "REFRESH_TOKEN_INVALID",
      StatusCodes.UNAUTHORIZED,
      "Refresh token not found or already rotated",
    );
  }
}

export class TokenExpiredError extends HttpError {
  constructor() {
    super("TOKEN_EXPIRED", StatusCodes.UNAUTHORIZED, "Token has expired");
  }
}

export class InvalidTokenError extends HttpError {
  constructor() {
    super(
      "INVALID_TOKEN",
      StatusCodes.UNAUTHORIZED,
      "Invalid or missing token",
    );
  }
}

export class TokenRevokedError extends HttpError {
  constructor() {
    super("TOKEN_REVOKED", StatusCodes.UNAUTHORIZED, "Token has been revoked");
  }
}

export class AccountLockedError extends HttpError {
  constructor(retryAfterSeconds: number | null = null) {
    super(
      "ACCOUNT_LOCKED",
      StatusCodes.TOO_MANY_REQUESTS,
      "Too many failed login attempts. Try again later.",
      retryAfterSeconds ? { retryAfterSeconds } : null,
    );
  }
}

export class UserNotFoundError extends HttpError {
  constructor() {
    super("USER_NOT_FOUND", StatusCodes.NOT_FOUND, "User not found");
  }
}

export class InvalidVerificationCodeError extends HttpError {
  constructor() {
    super(
      "INVALID_VERIFICATION_CODE",
      StatusCodes.BAD_REQUEST,
      "Invalid or expired verification code",
    );
  }
}
