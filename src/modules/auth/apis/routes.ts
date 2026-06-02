import { Router } from "express";
import { signup, login, refresh, logout } from "./handlers.js";
import { signupSchema, loginSchema } from "../schemas.js";
import { validate } from "../../../shared/middlewares/validate.js";
import { authenticate } from "../../../shared/middlewares/authenticate.js";
import { requireCookies } from "../../../shared/middlewares/requireCookies.js";
import { createRateLimiters } from "../../../shared/middlewares/rateLimiter.js";
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
