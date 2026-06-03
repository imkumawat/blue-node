import { getEnvConfig } from "../../../config/env.js";
import logger from "../../../utils/logger.js";

const VERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

/**
 * Server-side Cloudflare Turnstile verification. FAIL-CLOSED: any error, missing
 * secret, or non-success response returns false — a verification failure must
 * never silently pass. 3s timeout so a slow Turnstile call can't hang the login.
 */
export async function verifyCaptcha(
  token: string,
  ip: string,
): Promise<boolean> {
  const { turnstileSecret } = getEnvConfig().auth;
  if (!turnstileSecret) {
    logger.error("Turnstile secret not configured — rejecting captcha");
    return false;
  }

  try {
    const res = await fetch(VERIFY_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        secret: turnstileSecret,
        response: token,
        remoteip: ip,
      }),
      signal: AbortSignal.timeout(3000),
    });
    const data = (await res.json()) as { success?: boolean };
    return data.success === true;
  } catch (err) {
    logger.error(
      { err: err instanceof Error ? err.message : String(err) },
      "Turnstile verification failed",
    );
    return false;
  }
}
