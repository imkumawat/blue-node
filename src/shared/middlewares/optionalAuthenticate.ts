import type { RequestHandler } from "express";
import { verifyToken } from "../../modules/auth/services/verifyToken.js";

export function optionalAuthenticate(audience: string): RequestHandler {
  return async (req, _res, next) => {
    const token = req.cookies?.access_token ?? null;
    if (!token) {
      req.user = null;
      return next();
    }

    try {
      req.user = await verifyToken(token, audience);
    } catch {
      req.user = null;
    }

    next();
  };
}
