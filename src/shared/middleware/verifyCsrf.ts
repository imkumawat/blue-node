import type { Request, Response, NextFunction } from "express";
import { StatusCodes } from "http-status-codes";
import { HttpError } from "../errors/HttpError.js";
import { ERROR_MESSAGES } from "../constants/errors.js";

// Only needed when sameSite is "none" (cross-domain FE + BE).
// With sameSite: "lax" the browser handles CSRF protection — this middleware is unused.
export function verifyCsrf(
  req: Request,
  _res: Response,
  next: NextFunction,
): void {
  const cookieToken = req.cookies?.csrf_token;
  const headerToken = req.headers["x-csrf-token"];

  if (!cookieToken || cookieToken !== headerToken) {
    return next(
      new HttpError(
        "CSRF_MISSING",
        StatusCodes.FORBIDDEN,
        ERROR_MESSAGES.CSRF_MISSING,
      ),
    );
  }

  next();
}
