import type { GraphQLSchema } from "graphql";
import type {
  ApolloServerPlugin,
  GraphQLRequestContextDidResolveOperation,
} from "@apollo/server";
import { InvalidTokenError } from "../../modules/auth/errors.js";
import { ForbiddenError } from "../../shared/errors/ForbiddenError.js";
import type { GraphQLContext } from "../buildContext.js";
import {
  collectFieldsWithDirective,
  collectMatchedFields,
  getDirectiveArg,
} from "./directiveUtils.js";

interface AuthRule {
  scope: string | null;
}

export function createAuthPlugin(
  schema: GraphQLSchema,
): ApolloServerPlugin<GraphQLContext> {
  // @authenticated → auth required, no scope. @requireScope → auth implied + a
  // scope. Merge both into one map: any tagged field requires authentication.
  const rules = new Map<string, AuthRule>();
  for (const name of collectFieldsWithDirective(
    schema,
    "authenticated",
    () => null,
  ).keys()) {
    rules.set(name, { scope: null });
  }
  for (const [name, scope] of collectFieldsWithDirective(
    schema,
    "requireScope",
    (d) => getDirectiveArg(d, "scope"),
  )) {
    rules.set(name, { scope });
  }

  const check = (
    rule: AuthRule,
    ctx: GraphQLRequestContextDidResolveOperation<GraphQLContext>,
  ): void => {
    if (!ctx.contextValue.user) throw new InvalidTokenError();
    if (
      rule.scope &&
      !(ctx.contextValue.user.scopes ?? []).includes(rule.scope)
    ) {
      throw new ForbiddenError(`Missing required scope: ${rule.scope}`);
    }
  };

  return {
    async requestDidStart() {
      return {
        async didResolveOperation(ctx) {
          if (rules.size === 0 || !ctx.operation) return;
          for (const name of collectMatchedFields(
            ctx.operation,
            ctx.document,
            rules,
          )) {
            const rule = rules.get(name);
            if (rule) check(rule, ctx);
          }
        },
      };
    },
  };
}
