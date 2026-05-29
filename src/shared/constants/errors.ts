export const ERROR_MESSAGES = {
  // generic
  INTERNAL_SERVER_ERROR: "Internal server error",
  BAD_REQUEST: "Bad request",
  NOT_FOUND: "Resource not found",
  UNAUTHORIZED: "Unauthorized",
  FORBIDDEN: "Access denied",
  CONFLICT: "Resource already exists",
  INVALID_BODY: "Data validation failed",
  TOO_MANY_REQUESTS: "Too many requests. Please try again later",
  SERVICE_UNAVAILABLE: "Service unavailable, please try again later.",
  MISSING_COOKIE: "Required cookie is missing",
  CSRF_MISSING: "CSRF token is missing or invalid",

  // jwt auth
  TOKEN_MISSING: "Token is required",
  INVALID_TOKEN: "Invalid or missing token",
  TOKEN_EXPIRED: "Token has expired",
  TOKEN_REVOKED: "Token has been revoked",
  REFRESH_TOKEN_INVALID: "Refresh token not found or already rotated",
  AUTH_COOKIE_MISSING: "Authentication cookie is missing",
  INSUFFICIENT_SCOPES: "Insufficient scopes to access this resource",

  // api key auth
  INVALID_API_KEY: "Invalid or missing API key",
  API_KEY_EXPIRED: "API key has expired",

  // body
  INVALID_JSON: "Invalid JSON",
  PAYLOAD_TOO_LARGE: "Payload too large",
  GET_BODY_NOT_ALLOWED: "GET requests must not have a body",
} as const;
