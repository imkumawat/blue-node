import { randomToken } from "./crypto.js";

// NOTE: Only needed when sameSite is "none" (cross-domain FE + BE)
// Currently unused — sameSite: "lax" handles CSRF protection at browser level
// setCsrfCookie + clearCsrfCookie → shared/utils/cookies.ts
// verifyCsrf middleware → shared/middlewares/verifyCsrf.ts

export function generateCsrfToken(): string {
  return randomToken(32);
}
