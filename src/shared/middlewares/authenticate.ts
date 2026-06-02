import type { RequestHandler } from "express";
import { verifyToken } from "../../modules/auth/services/verifyToken.js";
import { InvalidTokenError } from "../../modules/auth/errors.js";

export function authenticate(audience: string): RequestHandler {
  return async (req, _res, next) => {
    try {
      const token = req.cookies?.access_token ?? null;
      if (!token) return next(new InvalidTokenError());

      req.user = await verifyToken(token, audience);
      next();
    } catch (err) {
      next(err);
    }
  };
}
