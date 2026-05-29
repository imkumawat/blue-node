import { Kind } from "graphql";
import type {
  GraphQLSchema,
  SelectionNode,
  FragmentDefinitionNode,
  DirectiveNode,
} from "graphql";
import type { ApolloServerPlugin } from "@apollo/server";
import { AliasingNotAllowedError } from "../../shared/errors/AliasingNotAllowedError.js";
import type { GraphQLContext } from "../buildContext.js";

function extractProtectedFields(schema: GraphQLSchema): Set<string> {
  const protectedFields = new Set<string>();
  for (const type of Object.values(schema.getTypeMap())) {
    if (type.name.startsWith("__")) continue;
    if (!("getFields" in type)) continue;
    for (const field of Object.values(type.getFields())) {
      const directives = field.astNode?.directives ?? [];
      if (directives.some((d: DirectiveNode) => d.name.value === "noAlias")) {
        protectedFields.add(field.name);
      }
    }
  }
  return protectedFields;
}

function countProtectedFields(
  selections: readonly SelectionNode[],
  fragmentMap: Map<string, FragmentDefinitionNode>,
  counts: Map<string, number>,
  visited: Set<string>,
  protectedFields: Set<string>,
): void {
  for (const sel of selections) {
    if (sel.kind === Kind.FIELD) {
      const name = sel.name.value;
      if (!protectedFields.has(name)) continue;
      const next = (counts.get(name) ?? 0) + 1;
      counts.set(name, next);
      if (next > 1) throw new AliasingNotAllowedError(name);
      continue;
    }
    if (sel.kind === Kind.INLINE_FRAGMENT) {
      countProtectedFields(
        sel.selectionSet.selections,
        fragmentMap,
        counts,
        visited,
        protectedFields,
      );
      continue;
    }
    if (sel.kind === Kind.FRAGMENT_SPREAD) {
      const fragName = sel.name.value;
      if (visited.has(fragName)) continue;
      const frag = fragmentMap.get(fragName);
      if (!frag) continue;
      visited.add(fragName);
      countProtectedFields(
        frag.selectionSet.selections,
        fragmentMap,
        counts,
        visited,
        protectedFields,
      );
    }
  }
}

export function createDisableAliasingPlugin(
  schema: GraphQLSchema,
): ApolloServerPlugin<GraphQLContext> {
  const protectedFields = extractProtectedFields(schema);

  return {
    async requestDidStart() {
      return {
        async didResolveOperation(ctx) {
          if (!ctx.operation) return;
          if (ctx.operation.operation !== "mutation") return;
          if (protectedFields.size === 0) return;

          const fragmentMap = new Map<string, FragmentDefinitionNode>();
          for (const def of ctx.document.definitions) {
            if (def.kind === Kind.FRAGMENT_DEFINITION) {
              fragmentMap.set(def.name.value, def);
            }
          }

          countProtectedFields(
            ctx.operation.selectionSet.selections,
            fragmentMap,
            new Map(),
            new Set(),
            protectedFields,
          );
        },
      };
    },
  };
}
