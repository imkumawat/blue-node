import { Router } from "express";

import {
  loginPrecheck,
  signup,
  verifyEmail,
  login,
  getCurrentUser,
  refreshSession,
  logout,
  changePassword,
  forgotPassword,
  resetPassword,
} from "./handlers.js";
import {
  signupSchema,
  verifyEmailSchema,
  loginSchema,
  changePasswordSchema,
  forgotPasswordSchema,
  resetPasswordSchema,
} from "../schemas.js";

import { validate } from "../../../shared/middlewares/validate.js";
import { authenticate } from "../../../shared/middlewares/authenticate.js";
import { requireCookies } from "../../../shared/middlewares/requireCookies.js";
import { createRateLimiters } from "../../../shared/middlewares/rateLimiter.js";

export function createAuthRoutes(): Router {
  const { authLimiter } = createRateLimiters();
  const router = Router();

  // auth routes risk detection
  router.post("/v1/auth/precheck", loginPrecheck);

  // sign up api
  router.post("/v1/auth/signup", authLimiter, validate(signupSchema), signup);

  // email verification post sign up
  router.post(
    "/v1/auth/verify-email",
    authLimiter,
    validate(verifyEmailSchema),
    verifyEmail,
  );

  // password based login
  router.post("/v1/auth/login", authLimiter, validate(loginSchema), login);

  // get profile
  router.get("/v1/user/me", authenticate(), getCurrentUser);

  // reshes auth session
  router.post(
    "/v1/auth/refresh-session",
    requireCookies("refresh_token"),
    refreshSession,
  );

  // logout session
  router.post(
    "/v1/auth/logout-session",
    authenticate(),
    requireCookies("refresh_token"),
    logout,
  );

  // change current password
  router.post(
    "/v1/auth/change-password",
    authenticate(),
    authLimiter,
    validate(changePasswordSchema),
    changePassword,
  );

  // forget password
  router.post(
    "/v1/auth/forgot-password",
    authLimiter,
    validate(forgotPasswordSchema),
    forgotPassword,
  );

  // account password hard reset
  router.post(
    "/v1/auth/reset-password",
    authLimiter,
    validate(resetPasswordSchema),
    resetPassword,
  );

  return router;
}
