import { mapSchema, getDirective, MapperKind } from "@graphql-tools/utils";
import { defaultFieldResolver } from "graphql";
import type { GraphQLSchema } from "graphql";
import { getRedis } from "../../lib/cache/redis/client.js";
import { RateLimitError } from "../../shared/errors/RateLimitError.js";
import type { GraphQLContext } from "../buildContext.js";

/**
 * General rate-limit directive transformer — counts ALL attempts (success and
 * failure) per IP. Broad DoS / abuse protection.
 *
 * For each field tagged @rateLimit(max, windowSec), wraps the resolver so every
 * call increments a per-IP counter before resolving; once the count exceeds max
 * within the window, further calls are rejected.
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
        const count = await getRedis().incr(key);
        if (count === 1) await getRedis().expire(key, windowSec);

        // Over the limit → reject before running the resolver.
        if (count > max) {
          const ttl = await getRedis().ttl(key);
          throw new RateLimitError(ttl > 0 ? ttl : windowSec);
        }

        return originalResolve(source, args, ctx, info);
      };

      return fieldConfig;
    },
  });
}
