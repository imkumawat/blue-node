import { getEnvConfig } from "../config/env.js";
import logger from "../utils/logger.js";

/**
 * Server-side Cloudflare Turnstile verification. Lives in src/lib as a generic
 * external-service client (like lib/aws); provider-neutral filename so the
 * captcha provider can be swapped without touching callers. FAIL-CLOSED: any
 * error, missing secret, or non-success → false (a failure never silently
 * passes). 3s timeout so a slow verify can't hang the login.
 */
export async function verifyCaptcha(
  token: string,
  ip: string,
): Promise<boolean> {
  const { turnstileSecret, verifyUrl } = getEnvConfig().captcha;
  if (!turnstileSecret) {
    logger.error("Turnstile secret not configured — rejecting captcha");
    return false;
  }

  try {
    const res = await fetch(verifyUrl, {
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
