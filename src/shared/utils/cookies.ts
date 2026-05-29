import type { Response } from "express";
import { getEnvConfig } from "../../config/env.js";

const ACCESS_COOKIE = "access_token";
const REFRESH_COOKIE = "refresh_token";
const ACCESS_PATH = "/";

interface SetAuthCookiesForParams {
  accessToken: string;
  refreshToken: string;
  accessExpiry: number;
  refreshExpiry: number;
  refreshPath: string;
}

/**
 * Internal helper — sets access + refresh cookies with the given expiries
 * and refresh path. Public wrappers (`setAuthCookies`, `setAdminAuthCookies`)
 * call this with their portal-specific options.
 */
function setAuthCookiesFor(
  res: Response,
  {
    accessToken,
    refreshToken,
    accessExpiry,
    refreshExpiry,
    refreshPath,
  }: SetAuthCookiesForParams,
): void {
  const { env } = getEnvConfig();
  const isProd = env === "production";
  const base = { httpOnly: true, secure: isProd, sameSite: "lax" as const };

  res.cookie(ACCESS_COOKIE, accessToken, {
    ...base,
    path: ACCESS_PATH,
    maxAge: accessExpiry * 1000,
  });

  res.cookie(REFRESH_COOKIE, refreshToken, {
    ...base,
    path: refreshPath,
    maxAge: refreshExpiry * 1000,
  });
}

function clearAuthCookiesFor(
  res: Response,
  { refreshPath }: { refreshPath: string },
): void {
  res.clearCookie(ACCESS_COOKIE, { path: ACCESS_PATH });
  res.clearCookie(REFRESH_COOKIE, { path: refreshPath });
}

// --- Public: user portal ---

export function setAuthCookies(
  res: Response,
  accessToken: string,
  refreshToken: string,
): void {
  const { jwt } = getEnvConfig();
  setAuthCookiesFor(res, {
    accessToken,
    refreshToken,
    accessExpiry: jwt.userAccessExpiry,
    refreshExpiry: jwt.userRefreshExpiry,
    refreshPath: "/api/v1/auth",
  });
}

export function clearAuthCookies(res: Response): void {
  clearAuthCookiesFor(res, { refreshPath: "/api/v1/auth" });
}

// --- Public: admin portal ---

export function setAdminAuthCookies(
  res: Response,
  accessToken: string,
  refreshToken: string,
): void {
  const { jwt } = getEnvConfig();
  setAuthCookiesFor(res, {
    accessToken,
    refreshToken,
    accessExpiry: jwt.adminAccessExpiry,
    refreshExpiry: jwt.adminRefreshExpiry,
    refreshPath: "/api/v1/admin/auth",
  });
}

export function clearAdminAuthCookies(res: Response): void {
  clearAuthCookiesFor(res, { refreshPath: "/api/v1/admin/auth" });
}

// --- CSRF (unchanged; only needed if sameSite ever switches to "none") ---

export function setCsrfCookie(res: Response, token: string): void {
  const { env } = getEnvConfig();
  const isProd = env === "production";

  // httpOnly: false — FE JS must read this to attach as X-CSRF-Token header
  res.cookie("csrf_token", token, {
    httpOnly: false,
    secure: isProd,
    sameSite: "none",
    path: "/",
  });
}

export function clearCsrfCookie(res: Response): void {
  res.clearCookie("csrf_token", { path: "/" });
}
