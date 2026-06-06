import type { GraphQLSchema } from "graphql";
import type { ApolloServerPlugin } from "@apollo/server";
import { getRedis } from "../../lib/cache/redis/client.js";
import { RateLimitError } from "../../shared/errors/RateLimitError.js";
import type { GraphQLContext } from "../buildContext.js";
import {
  collectFieldsWithDirective,
  collectMatchedFields,
  getDirectiveIntArg,
} from "./directiveUtils.js";

interface RateLimitConfig {
  max: number;
  windowSec: number;
}

const keyFor = (fieldName: string, ctx: GraphQLContext): string =>
  `rl:gql:authfail:${fieldName}:${ctx.ipAddress ?? "unknown"}`;

export function createAuthRateLimitPlugin(
  schema: GraphQLSchema,
): ApolloServerPlugin<GraphQLContext> {
  const rules = collectFieldsWithDirective<RateLimitConfig>(
    schema,
    "authRateLimit",
    (d) => ({
      max: getDirectiveIntArg(d, "max"),
      windowSec: getDirectiveIntArg(d, "windowSec"),
    }),
  );

  return {
    async requestDidStart() {
      let tracked: string[] = [];

      return {
        // Pre-check: if the failure counter is already at/over max, reject
        // before bcrypt runs (mirrors REST authLimiter's pre-check).
        async didResolveOperation(ctx) {
          if (rules.size === 0 || !ctx.operation) return;
          tracked = collectMatchedFields(ctx.operation, ctx.document, rules);

          for (const name of tracked) {
            const config = rules.get(name);
            if (!config) continue;
            const key = keyFor(name, ctx.contextValue);
            const count = parseInt((await getRedis().get(key)) ?? "0", 10);
            if (count >= config.max) {
              const ttl = await getRedis().ttl(key);
              throw new RateLimitError(ttl > 0 ? ttl : config.windowSec);
            }
          }
        },

        // Increment ONLY on failure (skipSuccessfulRequests equivalent) — a
        // successful login never punishes the legitimate user.
        async willSendResponse(ctx) {
          if (tracked.length === 0) return;

          const errors =
            ctx.response.body.kind === "single"
              ? (ctx.response.body.singleResult.errors ?? [])
              : [];

          const errorPaths = new Set<string | number>();
          for (const err of errors) {
            const top = err.path?.[0];
            if (top !== undefined) errorPaths.add(top);
          }
          if (errorPaths.size === 0) return;

          for (const name of tracked) {
            if (!errorPaths.has(name)) continue;
            const config = rules.get(name);
            if (!config) continue;
            const key = keyFor(name, ctx.contextValue);
            const count = await getRedis().incr(key);
            if (count === 1) await getRedis().expire(key, config.windowSec);
          }
        },
      };
    },
  };
}
