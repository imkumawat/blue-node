import { rateLimit } from "express-rate-limit";
import type { Options } from "express-rate-limit";
import { RedisStore } from "rate-limit-redis";
import type { Request, Response, NextFunction } from "express";
import { getRedis } from "../../lib/cache/redis/client.js";
import { getClientIp } from "../../utils/getClientIp.js";
import { sha256 } from "../utils/crypto.js";
import { RateLimitError } from "../errors/RateLimitError.js";
import { getEnvConfig } from "../../config/env.js";

const redisStore = (prefix: string) =>
  new RedisStore({
    prefix,
    sendCommand: (...args: string[]) =>
      getRedis().call(...(args as [string, ...string[]])) as Promise<
        number | string
      >,
  });

const rateLimitHandler = (
  _req: Request,
  _res: Response,
  next: NextFunction,
  options: Options,
): void => {
  const retryAfter = Math.ceil(options.windowMs / 1000);
  next(new RateLimitError(retryAfter));
};

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
    keyGenerator: (req: Request) => getClientIp(req),
    handler: rateLimitHandler,
  });

  /**
   * Per-authenticated-user rate limit. MUST be mounted AFTER authenticate()
   * — req.user should be populated. Falls back to IP if missing (defensive,
   * degrades to per-IP semantics instead of crashing if misconfigured).
   */
  const userLimiter = rateLimit({
    windowMs: rl.windowMs,
    limit: rl.maxUser,
    standardHeaders: true,
    legacyHeaders: false,
    store: redisStore(keys.rlUser),
    keyGenerator: (req: Request) => req.user?.id ?? getClientIp(req),
    handler: rateLimitHandler,
  });

  const authLimiter = rateLimit({
    windowMs: rl.windowMs,
    limit: rl.maxAuth,
    standardHeaders: true,
    legacyHeaders: false,
    skipSuccessfulRequests: true,
    store: redisStore(keys.rlAuth),
    keyGenerator: (req: Request) => getClientIp(req),
    handler: rateLimitHandler,
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
      if (!auth?.startsWith("ApiKey ")) return getClientIp(req);
      return sha256(auth.slice(7));
    },
    handler: rateLimitHandler,
  });

  return { ipLimiter, userLimiter, authLimiter, apiKeyLimiter };
}
