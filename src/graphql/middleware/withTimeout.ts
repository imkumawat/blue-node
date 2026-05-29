import type { GraphQLFieldResolver } from "graphql";
import { RequestTimeoutError } from "../../shared/errors/RequestTimeoutError.js";
import type { GraphQLContext } from "../buildContext.js";

/**
 * GraphQL resolver wrapper — races the resolver against a timer.
 * If the resolver doesn't settle in timeoutMs, throws RequestTimeoutError.
 *
 * Use for resolvers that hit external APIs or known-slow operations where
 * the global request timeout (10s) is too coarse or the underlying call
 * needs a tighter cap.
 *
 * NOTE: Promise.race rejects the awaiting promise but the original resolver
 * continues running in the background (no cancellation). Memory pressure
 * from leaked work is bounded by the upstream complexity limit.
 */
export function withTimeout(timeoutMs: number) {
  return <P, A>(
      resolver: GraphQLFieldResolver<P, GraphQLContext, A>,
    ): GraphQLFieldResolver<P, GraphQLContext, A> =>
    async (parent, args, ctx, info) => {
      let timer: NodeJS.Timeout | undefined;
      const timeoutPromise = new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new RequestTimeoutError(timeoutMs)),
          timeoutMs,
        );
      });

      try {
        return await Promise.race([
          resolver(parent, args, ctx, info),
          timeoutPromise,
        ]);
      } finally {
        clearTimeout(timer);
      }
    };
}
