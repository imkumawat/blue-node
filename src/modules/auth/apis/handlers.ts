import type { Request, Response } from "express";
import { StatusCodes } from "http-status-codes";
import { registerUser } from "../services/registerUser.js";
import { loginWithPassword } from "../services/loginWithPassword.js";
import { assessLoginRisk } from "../services/assessLoginRisk.js";
import { renewTokens } from "../services/refreshToken.js";
import { logoutUser } from "../services/logout.js";
import {
  setAuthCookies,
  clearAuthCookies,
} from "../../../shared/utils/cookies.js";
import { getClientIp } from "../../../utils/getClientIp.js";
import type { SignupInput, LoginInput } from "../schemas.js";

export async function signup(req: Request, res: Response): Promise<void> {
  const { email, password, consents } = req.body as SignupInput;

  const consentMeta = {
    ipAddress: getClientIp(req),
    userAgent: req.headers["user-agent"],
    platform: (req.headers["x-platform"] as string | undefined) ?? "web",
  };

  const { user, access, refresh } = await registerUser({
    email,
    password,
    consents,
    consentMeta,
  });

  setAuthCookies(res, access.token, refresh.token);
  res.status(StatusCodes.CREATED).json({
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
    accessJti: user.jti,
    accessExp: user.exp,
    rawRefreshToken: req.cookies.refresh_token,
  });

  clearAuthCookies(res);
  res
    .status(StatusCodes.OK)
    .json({ success: true, message: "Logged out successfully" });
}
