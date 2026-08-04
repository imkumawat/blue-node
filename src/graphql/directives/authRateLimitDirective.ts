import { mapSchema, getDirective, MapperKind } from "@graphql-tools/utils";
import { defaultFieldResolver } from "graphql";
import type { GraphQLSchema } from "graphql";
import { getRedis } from "../../lib/cache/redis/client.js";
import { RateLimitError } from "../../shared/errors/RateLimitError.js";
import logger from "../../utils/logger.js";
import type { GraphQLContext } from "../buildContext.js";
import { retryAfter } from "./retryAfter.js";

/**
 * Auth rate-limit directive transformer — counts ONLY failed attempts
 * (the skipSuccessfulRequests equivalent; mirrors REST's authLimiter).
 *
 * For each field tagged @authRateLimit(max, windowSec), wraps the resolver:
 *  - before resolving: if the per-IP failure counter is already at/over max, reject.
 *  - if the resolver throws (a failure): increment the counter, then re-throw.
 *  - on success: the counter is untouched, so legitimate users are never punished.
 *
 * The pre-check fails CLOSED if Redis is unreachable, unlike @rateLimit. Same
 * reasoning as REST's authLimiter: failing open would drop brute-force protection
 * at exactly the moment an attacker may be the one generating the load, and it
 * buys no availability, because the login resolver behind it needs Redis anyway.
 */
export function authRateLimitDirectiveTransformer(
  schema: GraphQLSchema,
): GraphQLSchema {
  return mapSchema(schema, {
    [MapperKind.OBJECT_FIELD]: (fieldConfig, fieldName) => {
      const directive = getDirective(schema, fieldConfig, "authRateLimit")?.[0];
      if (!directive) return fieldConfig;

      // Directive args arrive already typed: { max: 5, windowSec: 900 }.
      const max = directive.max as number;
      const windowSec = directive.windowSec as number;

      const originalResolve = fieldConfig.resolve ?? defaultFieldResolver;

      fieldConfig.resolve = async (source, args, ctx: GraphQLContext, info) => {
        const ip = ctx.ipAddress ?? "unknown";
        const key = `rl:gql:authfail:${fieldName}:${ip}`;

        // Pre-check: too many prior failures → reject before doing any work.
        const current = parseInt((await getRedis().get(key)) ?? "0", 10);
        if (current >= max) {
          throw new RateLimitError(await retryAfter(key, windowSec));
        }

        try {
          // Run the real resolver (e.g. login).
          return await originalResolve(source, args, ctx, info);
        } catch (err) {
          // Failure → bump the counter (set TTL on the first failure), then re-throw.
          //
          // Best-effort, and the inner catch is the load-bearing part. `err` here
          // is the caller's real answer — "invalid credentials", a 401 with a
          // reason. An unguarded store failure on this line would escape in its
          // place and hand back a 500 instead, losing the reason and reporting a
          // server fault for what was a correctly rejected login. Recording the
          // attempt is bookkeeping; it does not get to overwrite the outcome.
          try {
            const count = await getRedis().incr(key);
            if (count === 1) await getRedis().expire(key, windowSec);
          } catch (storeErr) {
            logger.error(
              {
                err:
                  storeErr instanceof Error
                    ? storeErr.message
                    : String(storeErr),
                field: fieldName,
              },
              "Auth rate limit: failed attempt not counted, store unavailable",
            );
          }
          throw err;
        }
      };

      return fieldConfig;
    },
  });
}
