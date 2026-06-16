import type { RequestHandler } from "express";
import { StatusCodes } from "http-status-codes";
import { verifyToken } from "../../modules/auth/index.js";
import { HttpError } from "../errors/HttpError.js";
import { ERROR_MESSAGES } from "../constants/errors.js";

export function authenticateMobile(audience: string): RequestHandler {
  return async (req, _res, next) => {
    try {
      const header = req.headers.authorization;
      const token = header?.startsWith("Bearer ") ? header.slice(7) : null;
      if (!token) {
        return next(
          new HttpError(
            "TOKEN_MISSING",
            StatusCodes.UNAUTHORIZED,
            ERROR_MESSAGES.TOKEN_MISSING,
          ),
        );
      }
      req.user = await verifyToken(token, audience);
      next();
    } catch (err) {
      next(err);
    }
  };
}
