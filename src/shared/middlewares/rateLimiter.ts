import { rateLimit, ipKeyGenerator } from "express-rate-limit";
import type { Logger, Options } from "express-rate-limit";
import { RedisStore } from "rate-limit-redis";
import type { Request, Response, NextFunction } from "express";
import { getRedis } from "../../lib/cache/redis/client.js";
import { getClientIp } from "../../utils/getClientIp.js";
import { sha256 } from "../utils/crypto.js";
import { RateLimitError } from "../errors/RateLimitError.js";
import { getEnvConfig } from "../../config/env.js";
import logger from "../../utils/logger.js";

const redisStore = (prefix: string) =>
  new RedisStore({
    prefix,
    sendCommand: (...args: string[]) =>
      getRedis().call(...(args as [string, ...string[]])) as Promise<
        number | string
      >,
  });

/**
 * express-rate-limit logs store failures itself, and by default straight to the
 * console — which would make a Redis outage the one class of error in this app
 * that never reaches pino, carries no requestId, and is invisible to whatever
 * ships the logs. Route it through our logger instead.
 */
const storeLogger: Logger = {
  error: (err: unknown, message?: string) =>
    logger.error(
      { err: err instanceof Error ? err.message : String(err) },
      message ?? "Rate limit store error",
    ),
  warn: (err: unknown, message?: string) =>
    logger.warn(
      { err: err instanceof Error ? err.message : String(err) },
      message ?? "Rate limit store warning",
    ),
};

const rateLimitHandler = (
  _req: Request,
  _res: Response,
  next: NextFunction,
  options: Options,
): void => {
  const retryAfter = Math.ceil(options.windowMs / 1000);
  next(new RateLimitError(retryAfter));
};

/**
 * What a limiter does when REDIS ITSELF fails — not when a caller is over limit.
 *
 * express-rate-limit defaults `passOnStoreError` to false: a store error is
 * re-thrown, lands in errorHandler, and the caller gets an opaque 500. On the
 * traffic limiters that default is the wrong answer, and `ipLimiter` shows why
 * most sharply — it is mounted app-wide in app.ts AHEAD of both mechanisms this
 * app has for surviving a Redis outage:
 *
 *   - serviceAvailability, which answers 503 with Retry-After and
 *     code: SERVICE_UNAVAILABLE, so clients back off instead of hammering.
 *   - /health, which pings each dependency independently and reports `degraded`
 *     naming the one that is down.
 *
 * The limiter throws before either can run. So a Redis hiccup of a few seconds
 * turns every request into a generic 500 — including the health probe a load
 * balancer polls to decide whether this process is alive, which would pull a
 * perfectly healthy Node process out of rotation over a cache blip. Both
 * degradation paths are defeated by the middleware standing in front of them.
 *
 * Hence: fail OPEN here. Briefly unlimited is a smaller loss than briefly
 * unavailable, and a request that genuinely needed Redis still fails downstream
 * with its own honest error. authLimiter is the deliberate exception — see it.
 */
const FAIL_OPEN = { passOnStoreError: true, logger: storeLogger } as const;

export function createRateLimiters() {
  const {
    rateLimit: rl,
    redis: { keys },
  } = getEnvConfig();

  const ipLimiter = rateLimit({
    windowMs: rl.windowMs,
    limit: rl.maxIp,
    standardHeaders: true,
    legacyHeaders: false,
    store: redisStore(keys.rlIp),
    // keyGenerator omitted — v8 default keys on req.ip with IPv6 /56 bucketing
    handler: rateLimitHandler,
    ...FAIL_OPEN,
  });

  /**
   * Per-authenticated-user rate limit. MUST be mounted AFTER authenticate()
   * — req.session should be populated. Falls back to IP if missing (defensive,
   * degrades to per-IP semantics instead of crashing if misconfigured).
   */
  const userLimiter = rateLimit({
    windowMs: rl.windowMs,
    limit: rl.maxUser,
    standardHeaders: true,
    legacyHeaders: false,
    store: redisStore(keys.rlUser),
    keyGenerator: (req: Request) =>
      req.session?.userId ?? ipKeyGenerator(getClientIp(req)),
    handler: rateLimitHandler,
    ...FAIL_OPEN,
  });

  /**
   * Login, signup, password reset — the endpoints an attacker guesses against.
   *
   * The ONLY limiter that fails closed, and the asymmetry is the point: failing
   * open here would remove brute-force protection at exactly the moment an
   * attacker may be the one generating the load that broke the store. It also
   * costs nothing in availability, which is what makes the choice cheap:
   * loginWithPassword and assessLoginRisk both need Redis, so no login can
   * succeed while the store is down no matter what this limiter decides. Closed
   * keeps the guarantee for free.
   *
   * `logger` is still wired so the store error is reported the same way as
   * everywhere else, even though the request is refused rather than passed.
   */
  const authLimiter = rateLimit({
    windowMs: rl.windowMs,
    limit: rl.maxAuth,
    standardHeaders: true,
    legacyHeaders: false,
    skipSuccessfulRequests: true,
    store: redisStore(keys.rlAuth),
    // keyGenerator omitted — v8 default keys on req.ip with IPv6 /56 bucketing
    handler: rateLimitHandler,
    logger: storeLogger,
  });

  /**
   * Per-API-key rate limit. MUST be mounted AFTER authenticateApiKey()
   * — Authorization: "ApiKey <key>" header should be present.
   *
   * SHA-256 hashes the raw key before keying Redis — plaintext keys must
   * never appear in Redis dumps / SLOWLOG / replication / backups.
   * Same hash function as `apiKeys/application/verifyApiKey.js`.
   *
   * Falls back to IP if header missing (defensive — degrades to per-IP
   * limit instead of pooling all anonymous requests into one bucket).
   */
  const apiKeyLimiter = rateLimit({
    windowMs: rl.windowMs,
    limit: rl.maxApiKey,
    standardHeaders: true,
    legacyHeaders: false,
    store: redisStore(keys.rlApiKey),
    keyGenerator: (req: Request) => {
      const auth = req.headers.authorization;
      if (!auth?.startsWith("ApiKey ")) return ipKeyGenerator(getClientIp(req));
      return sha256(auth.slice(7));
    },
    handler: rateLimitHandler,
    ...FAIL_OPEN,
  });

  return { ipLimiter, userLimiter, authLimiter, apiKeyLimiter };
}
