import { Router } from "express";
import { signup, login, refresh, logout } from "./handlers.js";
import { signupSchema, loginSchema } from "../schemas.js";
import { validate } from "../../../shared/middleware/validate.js";
import { authenticate } from "../../../shared/middleware/authenticate.js";
import { requireCookies } from "../../../shared/middleware/requireCookies.js";
import { createRateLimiters } from "../../../shared/middleware/rateLimiter.js";
import { getEnvConfig } from "../../../config/env.js";

export function createAuthRoutes(): Router {
  const { userAudience } = getEnvConfig().jwt;
  const { authLimiter } = createRateLimiters();
  const router = Router();

  router.post("/v1/auth/signup", authLimiter, validate(signupSchema), signup);
  router.post("/v1/auth/login", authLimiter, validate(loginSchema), login);
  router.post("/v1/auth/refresh", requireCookies("refresh_token"), refresh);
  router.post(
    "/v1/auth/logout",
    authenticate(userAudience),
    requireCookies("refresh_token"),
    logout,
  );

  return router;
}
