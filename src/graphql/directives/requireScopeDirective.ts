import { mapSchema, getDirective, MapperKind } from "@graphql-tools/utils";
import { defaultFieldResolver } from "graphql";
import type { GraphQLSchema } from "graphql";
import { InvalidTokenError } from "../../modules/auth/index.js";
import { ForbiddenError } from "../../shared/errors/ForbiddenError.js";
import type { GraphQLContext } from "../buildContext.js";

/**
 * Authorization directive transformer — the GraphQL equivalent of REST's
 * `authorize(...scopes)` middleware.
 *
 * For each field tagged `@requireScope(scope: "...")`, wraps the resolver so the
 * request must (1) be authenticated AND (2) carry the named scope. Authentication
 * is implied — a @requireScope field does not also need @authenticated.
 *
 * Type-aware by construction: only the exact tagged field is wrapped, so a
 * same-named field in another type is never accidentally protected.
 */
export function requireScopeDirectiveTransformer(
  schema: GraphQLSchema,
): GraphQLSchema {
  return mapSchema(schema, {
    [MapperKind.OBJECT_FIELD]: (fieldConfig) => {
      // Does this exact field carry @requireScope?
      const directive = getDirective(schema, fieldConfig, "requireScope")?.[0];
      if (!directive) return fieldConfig;

      // The scope this field demands, read from the directive's arguments
      // (e.g. { scope: "admin" }).
      const requiredScope = directive.scope as string;

      const originalResolve = fieldConfig.resolve ?? defaultFieldResolver;

      fieldConfig.resolve = (source, args, ctx: GraphQLContext, info) => {
        // Step 1: must be authenticated (authorization implies authentication).
        if (!ctx.user) {
          throw new InvalidTokenError();
        }
        // Step 2: must hold the required scope.
        const userScopes = ctx.user.scopes ?? [];
        if (!userScopes.includes(requiredScope)) {
          throw new ForbiddenError(`Missing required scope: ${requiredScope}`);
        }
        // Both checks passed → run the original resolver.
        return originalResolve(source, args, ctx, info);
      };

      return fieldConfig;
    },
  });
}
