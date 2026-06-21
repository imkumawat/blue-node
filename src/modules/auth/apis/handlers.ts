import type { Request, Response } from "express";
import { StatusCodes } from "http-status-codes";
import { registerUser } from "../services/registerUser.js";
import { verifyEmail as verifyEmailService } from "../services/verifyEmail.js";
import { loginWithPassword } from "../services/loginWithPassword.js";
import { assessLoginRisk } from "../services/assessLoginRisk.js";
import { renewTokens } from "../services/refreshToken.js";
import { logoutUser } from "../services/logout.js";
import { requestPasswordReset } from "../services/requestPasswordReset.js";
import { resetPassword as resetPasswordService } from "../services/resetPassword.js";
import { changePassword as changePasswordService } from "../services/changePassword.js";
import {
  setAuthCookies,
  clearAuthCookies,
} from "../../../shared/utils/cookies.js";
import { getClientIp } from "../../../utils/getClientIp.js";
import type {
  SignupInput,
  LoginInput,
  VerifyEmailInput,
  ForgotPasswordInput,
  ResetPasswordInput,
  ChangePasswordInput,
} from "../schemas.js";

export async function signup(req: Request, res: Response): Promise<void> {
  const { email, password, consents } = req.body as SignupInput;

  const consentMeta = {
    ipAddress: getClientIp(req),
    userAgent: req.headers["user-agent"],
    platform: (req.headers["x-platform"] as string | undefined) ?? "web",
  };

  const { user } = await registerUser({
    email,
    password,
    consents,
    consentMeta,
  });

  // No session yet — the user must verify their email (POST /v1/auth/verify-email)
  // before any tokens are issued.
  res.status(StatusCodes.CREATED).json({
    success: true,
    data: {
      user: {
        id: user.id,
        email: user.email,
        status: user.status,
        createdAt: user.createdAt,
      },
      verificationRequired: true,
    },
  });
}

export async function verifyEmail(req: Request, res: Response): Promise<void> {
  const { email, code } = req.body as VerifyEmailInput;

  // Code valid → account activated → issue tokens (first login) + set cookies.
  const { user, access, refresh } = await verifyEmailService({ email, code });

  setAuthCookies(res, access.token, refresh.token);
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
  res.status(StatusCodes.OK).json({
    success: true,
    message: "Password reset successful. Please log in.",
  });
}

export async function changePassword(
  req: Request,
  res: Response,
): Promise<void> {
  const { currentPassword, newPassword } = req.body as ChangePasswordInput;

  await changePasswordService({
    userId: req.user!.id,
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

export async function loginPrecheck(
  req: Request,
  res: Response,
): Promise<void> {
  // Pre-login risk check (CLIENT/IP-based) — FE calls this before showing the
  // login form to decide whether to render a CAPTCHA. Not account-gated.
  const risk = await assessLoginRisk(getClientIp(req));
  res.status(StatusCodes.OK).json({ success: true, data: risk });
}

export async function login(req: Request, res: Response): Promise<void> {
  const { email, password, captchaToken } = req.body as LoginInput;

  const { user, access, refresh } = await loginWithPassword({
    email,
    password,
    ipAddress: getClientIp(req),
    captchaToken,
  });

  setAuthCookies(res, access.token, refresh.token);
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

export async function refresh(req: Request, res: Response): Promise<void> {
  const { access, refresh } = await renewTokens(req.cookies.refresh_token);

  setAuthCookies(res, access.token, refresh.token);
  res
    .status(StatusCodes.OK)
    .json({ success: true, message: "Token refreshed" });
}

export async function logout(req: Request, res: Response): Promise<void> {
  const user = req.user!;
  await logoutUser({
    userId: user.id,
    sessionId: user.sessionId,
    accessJti: user.jti,
    accessExp: user.exp,
    rawRefreshToken: req.cookies.refresh_token,
  });

  clearAuthCookies(res);
  res
    .status(StatusCodes.OK)
    .json({ success: true, message: "Logged out successfully" });
}
