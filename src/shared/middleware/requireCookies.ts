import type { RequestHandler } from "express";
import { StatusCodes } from "http-status-codes";
import { HttpError } from "../errors/HttpError.js";
import { ERROR_MESSAGES } from "../constants/errors.js";

export function requireCookies(...cookieNames: string[]): RequestHandler {
  return function (req, _res, next) {
    for (const name of cookieNames) {
      if (!req.cookies?.[name]) {
        return next(
          new HttpError(
            "MISSING_COOKIE",
            StatusCodes.UNAUTHORIZED,
            ERROR_MESSAGES.MISSING_COOKIE,
          ),
        );
      }
    }
    next();
  };
}
