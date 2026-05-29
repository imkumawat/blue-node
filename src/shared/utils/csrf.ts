import { randomBytes } from "crypto";

// NOTE: Only needed when sameSite is "none" (cross-domain FE + BE)
// Currently unused — sameSite: "lax" handles CSRF protection at browser level
// setCsrfCookie + clearCsrfCookie → shared/utils/cookies.ts
// verifyCsrf middleware → shared/middleware/verifyCsrf.ts

export function generateCsrfToken(): string {
  return randomBytes(32).toString("hex");
}
