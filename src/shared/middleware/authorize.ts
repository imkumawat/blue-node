import type { RequestHandler } from "express";
import { StatusCodes } from "http-status-codes";
import { HttpError } from "../errors/HttpError.js";
import { ERROR_MESSAGES } from "../constants/errors.js";
import type { Scope } from "../constants/scopes.js";

export function authorize(...requiredScopes: Scope[]): RequestHandler {
  return (req, _res, next) => {
    const userScopes = req.user?.scopes ?? [];
    const hasAll = requiredScopes.every((scope) => userScopes.includes(scope));
    if (!hasAll) {
      return next(
        new HttpError(
          "INSUFFICIENT_SCOPES",
          StatusCodes.FORBIDDEN,
          ERROR_MESSAGES.INSUFFICIENT_SCOPES,
        ),
      );
    }
    next();
  };
}
