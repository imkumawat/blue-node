import { mapSchema, getDirective, MapperKind } from "@graphql-tools/utils";
import { defaultFieldResolver } from "graphql";
import type { GraphQLSchema } from "graphql";
import { InvalidTokenError } from "../../modules/auth/errors.js";
import type { GraphQLContext } from "../buildContext.js";

/**
 * Authentication directive transformer — the GraphQL equivalent of REST's
 * `authenticate` middleware.
 *
 * At schema-build time, this walks every object field once. For each field
 * tagged with `@authenticated`, it wraps that field's resolver so the request
 * must carry a logged-in user (ctx.user) before the field resolves; otherwise
 * it throws InvalidTokenError (a 401-style error).
 *
 * Type-aware by construction: `X.field` and `Y.field` are distinct fieldConfig
 * objects, so only the field that actually carries the directive is wrapped.
 * A same-named field in another type is never accidentally protected — the
 * field-name collision problem of the name-matching plugin cannot happen here.
 */
export function authenticatedDirectiveTransformer(
  schema: GraphQLSchema,
): GraphQLSchema {
  return mapSchema(schema, {
    // Runs once per object field at boot.
    [MapperKind.OBJECT_FIELD]: (fieldConfig) => {
      // Does this exact field carry @authenticated?
      const directive = getDirective(schema, fieldConfig, "authenticated")?.[0];

      // No directive → leave the field untouched.
      if (!directive) return fieldConfig;

      // Remember the original resolver (or the default field resolver), then
      // wrap it with the auth check.
      const originalResolve = fieldConfig.resolve ?? defaultFieldResolver;

      fieldConfig.resolve = (source, args, ctx: GraphQLContext, info) => {
        // Before resolving: a logged-in user is required.
        if (!ctx.user) {
          throw new InvalidTokenError();
        }
        // Authenticated → run the original resolver as normal.
        return originalResolve(source, args, ctx, info);
      };

      return fieldConfig;
    },
  });
}
