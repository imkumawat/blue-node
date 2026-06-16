import type { RequestHandler } from "express";
import { verifyToken, InvalidTokenError } from "../../modules/auth/index.js";

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
