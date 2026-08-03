import type { RequestHandler } from "express";
import {
  verifySessionToken,
  InvalidTokenError,
  InvalidAuthSessionError,
} from "../../modules/auth/index.js";

export function authenticateMobile(): RequestHandler {
  return async (req, _res, next) => {
    try {
      const header = req.headers.authorization;
      const token = header?.startsWith("Bearer ") ? header.slice(7) : null;
      if (!token) {
        return next(new InvalidTokenError());
      }
      const record = await verifySessionToken(token);

      if (!record) return next(new InvalidAuthSessionError());

      req.session = record;
      next();
    } catch (err) {
      next(err);
    }
  };
}
