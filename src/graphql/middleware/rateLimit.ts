import type { GraphQLFieldResolver } from "graphql";
import { getRedis } from "../../lib/cache/redis/client.js";
import { RateLimitError } from "../../shared/errors/RateLimitError.js";
import type { GraphQLContext } from "../buildContext.js";

export function rateLimitResolver({
  key,
  max,
  windowSec,
}: {
  key: string;
  max: number;
  windowSec: number;
}) {
  return <P, A>(
      resolver: GraphQLFieldResolver<P, GraphQLContext, A>,
    ): GraphQLFieldResolver<P, GraphQLContext, A> =>
    async (parent, args, ctx, info) => {
      const id = ctx.ipAddress ?? "unknown";
      const redisKey = `rl:gql:${key}:${id}`;

      const count = await getRedis().incr(redisKey);
      if (count === 1) await getRedis().expire(redisKey, windowSec);

      if (count > max) {
        const ttl = await getRedis().ttl(redisKey);
        throw new RateLimitError(ttl > 0 ? ttl : windowSec);
      }

      return resolver(parent, args, ctx, info);
    };
}
