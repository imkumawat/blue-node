import type { GraphQLSchema } from "graphql";
import type { ApolloServerPlugin } from "@apollo/server";
import { AliasingNotAllowedError } from "../../shared/errors/AliasingNotAllowedError.js";
import type { GraphQLContext } from "../buildContext.js";
import {
  collectFieldsWithDirective,
  collectMatchedFields,
} from "./directiveUtils.js";

export function createDisableAliasingPlugin(
  schema: GraphQLSchema,
): ApolloServerPlugin<GraphQLContext> {
  const protectedFields = collectFieldsWithDirective(
    schema,
    "noAlias",
    () => true,
  );

  return {
    async requestDidStart() {
      return {
        async didResolveOperation(ctx) {
          if (protectedFields.size === 0) return;
          if (!ctx.operation || ctx.operation.operation !== "mutation") return;

          // A protected field selected 2+ times (only possible via aliasing,
          // since duplicate identical selections collapse) → reject.
          const counts = new Map<string, number>();
          for (const name of collectMatchedFields(
            ctx.operation,
            ctx.document,
            protectedFields,
          )) {
            const next = (counts.get(name) ?? 0) + 1;
            if (next > 1) throw new AliasingNotAllowedError(name);
            counts.set(name, next);
          }
        },
      };
    },
  };
}
