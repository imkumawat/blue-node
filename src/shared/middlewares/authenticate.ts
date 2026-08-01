import type { RequestHandler } from "express";
import {
  verifySessionToken,
  InvalidTokenError,
} from "../../modules/auth/index.js";

export function authenticate(): RequestHandler {
  return async (req, _res, next) => {
    try {
      const token = req.cookies?.access_token ?? null;
      if (!token) return next(new InvalidTokenError());

      req.user = await verifySessionToken(token);
      next();
    } catch (err) {
      next(err);
    }
  };
}
