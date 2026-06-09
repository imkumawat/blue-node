import { mapSchema, getDirective, MapperKind } from "@graphql-tools/utils";
import { defaultFieldResolver } from "graphql";
import type { GraphQLSchema } from "graphql";
import { getRedis } from "../../lib/cache/redis/client.js";
import { RateLimitError } from "../../shared/errors/RateLimitError.js";
import type { GraphQLContext } from "../buildContext.js";

/**
 * Auth rate-limit directive transformer — counts ONLY failed attempts
 * (the skipSuccessfulRequests equivalent; mirrors REST's authLimiter).
 *
 * For each field tagged @authRateLimit(max, windowSec), wraps the resolver:
 *  - before resolving: if the per-IP failure counter is already at/over max, reject.
 *  - if the resolver throws (a failure): increment the counter, then re-throw.
 *  - on success: the counter is untouched, so legitimate users are never punished.
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
          const ttl = await getRedis().ttl(key);
          throw new RateLimitError(ttl > 0 ? ttl : windowSec);
        }

        try {
          // Run the real resolver (e.g. login).
          return await originalResolve(source, args, ctx, info);
        } catch (err) {
          // Failure → bump the counter (set TTL on the first failure), then re-throw.
          const count = await getRedis().incr(key);
          if (count === 1) await getRedis().expire(key, windowSec);
          throw err;
        }
      };

      return fieldConfig;
    },
  });
}
