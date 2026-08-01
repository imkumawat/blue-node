import type { RequestHandler } from "express";
import { verifySessionToken } from "../../modules/auth/index.js";

export function optionalAuthenticate(): RequestHandler {
  return async (req, _res, next) => {
    const token = req.cookies?.access_token ?? null;
    if (!token) {
      req.user = null;
      return next();
    }

    try {
      req.user = await verifySessionToken(token);
    } catch {
      req.user = null;
    }

    next();
  };
}
