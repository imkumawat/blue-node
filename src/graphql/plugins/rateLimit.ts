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

export function createRateLimitPlugin(
  schema: GraphQLSchema,
): ApolloServerPlugin<GraphQLContext> {
  const fields = collectFieldsWithDirective<RateLimitConfig>(
    schema,
    "rateLimit",
    (d) => ({
      max: getDirectiveIntArg(d, "max"),
      windowSec: getDirectiveIntArg(d, "windowSec"),
    }),
  );

  return {
    async requestDidStart() {
      return {
        async didResolveOperation(ctx) {
          if (fields.size === 0 || !ctx.operation) return;
          const id = ctx.contextValue.ipAddress ?? "unknown";

          // Counts ALL attempts (success + failure) — general DoS protection.
          for (const name of collectMatchedFields(
            ctx.operation,
            ctx.document,
            fields,
          )) {
            const config = fields.get(name);
            if (!config) continue;
            const key = `rl:gql:${name}:${id}`;
            const count = await getRedis().incr(key);
            if (count === 1) await getRedis().expire(key, config.windowSec);
            if (count > config.max) {
              const ttl = await getRedis().ttl(key);
              throw new RateLimitError(ttl > 0 ? ttl : config.windowSec);
            }
          }
        },
      };
    },
  };
}
