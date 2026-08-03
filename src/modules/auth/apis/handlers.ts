import { StatusCodes } from "http-status-codes";

import { assessLoginRisk } from "../services/assessLoginRisk.js";
import { registerUser } from "../services/registerUser.js";
import { verifyEmail as verifyEmailService } from "../services/verifyEmail.js";
import { loginWithPassword } from "../services/loginWithPassword.js";
import { getUserById } from "../services/getUserById.js";
import { renewSession } from "../services/renewSession.js";
import { logoutUser } from "../services/logout.js";
import { changePassword as changePasswordService } from "../services/changePassword.js";
import { requestPasswordReset } from "../services/requestPasswordReset.js";
import { resetPassword as resetPasswordService } from "../services/resetPassword.js";

import {
  setAuthCookies,
  clearAuthCookies,
} from "../../../shared/utils/cookies.js";
import { getClientIp } from "../../../utils/getClientIp.js";

import type { Request, Response } from "express";
import type {
  SignupInput,
  VerifyEmailInput,
  LoginInput,
  ChangePasswordInput,
  ForgotPasswordInput,
  ResetPasswordInput,
} from "../schemas.js";

export async function loginPrecheck(
  req: Request,
  res: Response,
): Promise<void> {
  // Pre-login risk check (CLIENT/IP-based) — FE calls this before showing the
  // login form to decide whether to render a CAPTCHA. Not account-gated.
  const risk = await assessLoginRisk(getClientIp(req));
  res.status(StatusCodes.OK).json({ success: true, data: risk });
}

export async function signup(req: Request, res: Response): Promise<void> {
  const { email, password, consents, firstName, lastName } =
    req.body as SignupInput;

  const consentMeta = {
    ipAddress: getClientIp(req),
    userAgent: req.headers["user-agent"] || null,
    platform: (req.headers["x-platform"] as string) ?? "web",
  };

  const { user } = await registerUser({
    email,
    password,
    consents,
    consentMeta,
    firstName,
    lastName,
  });

  res.status(StatusCodes.CREATED).json({
    success: true,
    data: { user, verificationRequired: true },
  });
}

export async function verifyEmail(req: Request, res: Response): Promise<void> {
  const { email, code } = req.body as VerifyEmailInput;

  // Code valid → account activated → issue tokens (first login) + set cookies.
  const { user, credentials } = await verifyEmailService({
    email,
    code,
    ipAddress: getClientIp(req),
    userAgent: req.headers["user-agent"] ?? null,
  });

  setAuthCookies(res, credentials.accessToken, credentials.refreshToken);
  res.status(StatusCodes.OK).json({
    success: true,
    data: { user },
  });
}

export async function login(req: Request, res: Response): Promise<void> {
  const { email, password, captchaToken } = req.body as LoginInput;

  const { user, credentials } = await loginWithPassword({
    email,
    password,
    ipAddress: getClientIp(req),
    userAgent: req.headers["user-agent"] ?? null,
    captchaToken,
  });

  setAuthCookies(res, credentials.accessToken, credentials.refreshToken);
  res.status(StatusCodes.OK).json({
    success: true,
    data: {
      user: {
        id: user.id,
        email: user.email,
        status: user.status,
        createdAt: user.createdAt,
      },
    },
  });
}

export async function getCurrentUser(
  req: Request,
  res: Response,
): Promise<void> {
  const userId = req.session!.userId;
  const user = await getUserById(userId);

  res.status(StatusCodes.OK).json({
    success: true,
    data: { user },
  });
}

export async function refreshSession(
  req: Request,
  res: Response,
): Promise<void> {
  const credentials = await renewSession(req.cookies.refresh_token);

  setAuthCookies(res, credentials.accessToken, credentials.refreshToken);
  res
    .status(StatusCodes.OK)
    .json({ success: true, message: "Session refreshed" });
}

export async function logout(req: Request, res: Response): Promise<void> {
  const user = req.session!;
  await logoutUser({
    userId: user.userId,
    sessionId: user.sessionId,
  });

  clearAuthCookies(res);
  res
    .status(StatusCodes.OK)
    .json({ success: true, message: "Logged out successfully" });
}

export async function changePassword(
  req: Request,
  res: Response,
): Promise<void> {
  const { currentPassword, newPassword } = req.body as ChangePasswordInput;

  await changePasswordService({
    userId: req.session!.userId,
    currentPassword,
    newPassword,
  });

  // All sessions were revoked — clear this client's cookies too so the FE
  // re-authenticates with the new password.
  clearAuthCookies(res);
  res.status(StatusCodes.OK).json({
    success: true,
    message: "Password changed. Please log in again.",
  });
}

export async function forgotPassword(
  req: Request,
  res: Response,
): Promise<void> {
  const { email } = req.body as ForgotPasswordInput;

  await requestPasswordReset({ email });

  // Always generic — never reveal whether the email is registered.
  res.status(StatusCodes.OK).json({
    success: true,
    message: "If an account exists, a reset code has been sent.",
  });
}

export async function resetPassword(
  req: Request,
  res: Response,
): Promise<void> {
  const { email, code, newPassword } = req.body as ResetPasswordInput;

  await resetPasswordService({ email, code, newPassword });

  // No tokens issued — the user logs in fresh with the new password.

  clearAuthCookies(res);
  res.status(StatusCodes.OK).json({
    success: true,
    message: "Password reset successful. Please log in.",
  });
}
