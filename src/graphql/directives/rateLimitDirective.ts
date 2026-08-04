import { mapSchema, getDirective, MapperKind } from "@graphql-tools/utils";
import { defaultFieldResolver } from "graphql";
import type { GraphQLSchema } from "graphql";
import { getRedis } from "../../lib/cache/redis/client.js";
import { RateLimitError } from "../../shared/errors/RateLimitError.js";
import logger from "../../utils/logger.js";
import type { GraphQLContext } from "../buildContext.js";
import { retryAfter } from "./retryAfter.js";

/**
 * General rate-limit directive transformer — counts ALL attempts (success and
 * failure) per IP. Broad DoS / abuse protection.
 *
 * For each field tagged @rateLimit(max, windowSec), wraps the resolver so every
 * call increments a per-IP counter before resolving; once the count exceeds max
 * within the window, further calls are rejected.
 *
 * Fails OPEN when Redis itself is unreachable, matching REST's ipLimiter — see
 * shared/middlewares/rateLimiter.ts for the full reasoning. The short version:
 * this guards against abuse, not against a security boundary being crossed, so
 * letting a cache blip decide the field cannot resolve trades a small risk for a
 * certain outage. @authRateLimit is the deliberate exception.
 */
export function rateLimitDirectiveTransformer(
  schema: GraphQLSchema,
): GraphQLSchema {
  return mapSchema(schema, {
    [MapperKind.OBJECT_FIELD]: (fieldConfig, fieldName) => {
      const directive = getDirective(schema, fieldConfig, "rateLimit")?.[0];
      if (!directive) return fieldConfig;

      const max = directive.max as number;
      const windowSec = directive.windowSec as number;

      const originalResolve = fieldConfig.resolve ?? defaultFieldResolver;

      fieldConfig.resolve = async (source, args, ctx: GraphQLContext, info) => {
        const ip = ctx.ipAddress ?? "unknown";
        const key = `rl:gql:${fieldName}:${ip}`;

        // Count this attempt (set TTL on the first hit in the window).
        // `null` means the store could not answer, which is NOT the same as
        // "under the limit" — it is "unknown", and the check below skips rather
        // than guesses. Kept out of the try below so a RateLimitError raised for
        // a genuinely over-limit caller is never mistaken for a store failure.
        let count: number | null = null;
        try {
          count = await getRedis().incr(key);
          if (count === 1) await getRedis().expire(key, windowSec);
        } catch (err) {
          logger.error(
            {
              err: err instanceof Error ? err.message : String(err),
              field: fieldName,
            },
            "GraphQL rate limit store error, allowing request unlimited",
          );
        }

        // Over the limit → reject before running the resolver.
        if (count !== null && count > max) {
          throw new RateLimitError(await retryAfter(key, windowSec));
        }

        return originalResolve(source, args, ctx, info);
      };

      return fieldConfig;
    },
  });
}
