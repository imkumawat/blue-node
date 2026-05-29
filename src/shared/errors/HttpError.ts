export class HttpError extends Error {
  code: string;
  statusCode: number;
  details: unknown | null;

  constructor(
    code: string = "INTERNAL_ERROR",
    statusCode: number = 500,
    message: string = "Internal server error",
    details: unknown | null = null,
  ) {
    super(message);
    this.name = "HttpError";
    this.code = code;
    this.statusCode = statusCode;
    this.details = details;
    Error.captureStackTrace(this, this.constructor);
  }
}
