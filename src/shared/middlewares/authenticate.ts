import type { RequestHandler } from "express";
import {
  verifySessionToken,
  InvalidTokenError,
  InvalidAuthSessionError,
} from "../../modules/auth/index.js";

export function authenticate(): RequestHandler {
  return async (req, _res, next) => {
    const token = req.cookies?.access_token ?? null;
    if (!token) return next(new InvalidTokenError());

    const record = await verifySessionToken(token);

    if (!record) return next(new InvalidAuthSessionError());

    req.session = record;
    next();
  };
}
