import { getRedis } from "../../../lib/cache/redis/client.js";
import { getEnvConfig } from "../../../config/env.js";

export interface LoginRisk {
  captchaRequired: boolean;
}

/**
 * Decide whether a login attempt should be CAPTCHA-challenged. Keyed on the
 * CLIENT (IP), NOT the target account — so an attacker cannot force a CAPTCHA
 * on a specific victim by pumping that account's failure count.
 *
 * Inert when the feature is disabled (CAPTCHA_ENABLED=false) → always false.
 * Used by both the pre-login /precheck endpoint and the login gate.
 */
export async function assessLoginRisk(ip: string): Promise<LoginRisk> {
  const { enabled, failThreshold } = getEnvConfig().captcha;
  if (!enabled) return { captchaRequired: false };

  const { authFailIp } = getEnvConfig().redis.keys;
  const fails = parseInt(
    (await getRedis().get(`${authFailIp}${ip}`)) ?? "0",
    10,
  );
  return { captchaRequired: fails >= failThreshold };
}
