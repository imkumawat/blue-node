import type { GraphQLFieldResolver } from "graphql";
import type { GraphQLContext } from "../buildContext.js";
import { InvalidTokenError } from "../../modules/auth/errors.js";

/**
 * GraphQL resolver wrapper — throws InvalidTokenError if ctx.user is missing.
 * Composable with compose() for stacking with rate limit, timeout, etc.
 */
export function requireAuth<P, A, R>(
  resolver: GraphQLFieldResolver<P, GraphQLContext, A, R>,
): GraphQLFieldResolver<P, GraphQLContext, A, R> {
  return (parent, args, ctx, info) => {
    if (!ctx.user) throw new InvalidTokenError();
    return resolver(parent, args, ctx, info);
  };
}
