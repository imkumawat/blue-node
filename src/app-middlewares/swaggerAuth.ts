import type { Request, Response, NextFunction } from "express";
import basicAuth from "express-basic-auth";
import { getEnvConfig } from "../config/env.js";

export function swaggerAuth(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const { env, swagger } = getEnvConfig();

  if (env !== "production") {
    next();
    return;
  }

  if (!swagger.user || !swagger.password) {
    res.status(503).json({
      success: false,
      message: "Swagger authentication is not configured",
    });
    return;
  }

  basicAuth({
    users: { [swagger.user]: swagger.password },
    challenge: true,
    realm: "Swagger UI",
  })(req, res, next);
}
