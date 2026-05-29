import { Kind } from "graphql";
import type {
  GraphQLSchema,
  SelectionNode,
  FragmentDefinitionNode,
  DirectiveNode,
} from "graphql";
import type {
  ApolloServerPlugin,
  GraphQLRequestContextDidResolveOperation,
} from "@apollo/server";
import { getRedis } from "../../lib/cache/redis/client.js";
import { RateLimitError } from "../../shared/errors/RateLimitError.js";
import type { GraphQLContext } from "../buildContext.js";

interface RateLimitConfig {
  max: number;
  windowSec: number;
}

function directiveIntArg(directive: DirectiveNode, argName: string): number {
  const arg = directive.arguments?.find((a) => a.name.value === argName);
  if (arg && "value" in arg.value) return parseInt(String(arg.value.value), 10);
  return 0;
}

function extractRateLimitFields(
  schema: GraphQLSchema,
): Map<string, RateLimitConfig> {
  const fields = new Map<string, RateLimitConfig>();
  for (const type of Object.values(schema.getTypeMap())) {
    if (type.name.startsWith("__")) continue;
    if (!("getFields" in type)) continue;
    for (const field of Object.values(type.getFields())) {
      const directive = (field.astNode?.directives ?? []).find(
        (d: DirectiveNode) => d.name.value === "rateLimit",
      );
      if (!directive) continue;
      fields.set(field.name, {
        max: directiveIntArg(directive, "max"),
        windowSec: directiveIntArg(directive, "windowSec"),
      });
    }
  }
  return fields;
}

async function enforce(
  fieldName: string,
  config: RateLimitConfig,
  ctx: GraphQLRequestContextDidResolveOperation<GraphQLContext>,
): Promise<void> {
  const id = ctx.contextValue.ipAddress ?? "unknown";
  const key = `rl:gql:${fieldName}:${id}`;
  const count = await getRedis().incr(key);
  if (count === 1) await getRedis().expire(key, config.windowSec);
  if (count > config.max) {
    const ttl = await getRedis().ttl(key);
    throw new RateLimitError(ttl > 0 ? ttl : config.windowSec);
  }
}

async function checkSelections(
  selections: readonly SelectionNode[],
  fragmentMap: Map<string, FragmentDefinitionNode>,
  visited: Set<string>,
  fields: Map<string, RateLimitConfig>,
  ctx: GraphQLRequestContextDidResolveOperation<GraphQLContext>,
): Promise<void> {
  for (const sel of selections) {
    if (sel.kind === Kind.FIELD) {
      const config = fields.get(sel.name.value);
      if (config) await enforce(sel.name.value, config, ctx);
      if (sel.selectionSet) {
        await checkSelections(
          sel.selectionSet.selections,
          fragmentMap,
          visited,
          fields,
          ctx,
        );
      }
    } else if (sel.kind === Kind.INLINE_FRAGMENT) {
      await checkSelections(
        sel.selectionSet.selections,
        fragmentMap,
        visited,
        fields,
        ctx,
      );
    } else if (sel.kind === Kind.FRAGMENT_SPREAD) {
      const name = sel.name.value;
      if (visited.has(name)) continue;
      const frag = fragmentMap.get(name);
      if (!frag) continue;
      visited.add(name);
      await checkSelections(
        frag.selectionSet.selections,
        fragmentMap,
        visited,
        fields,
        ctx,
      );
    }
  }
}

export function createRateLimitPlugin(
  schema: GraphQLSchema,
): ApolloServerPlugin<GraphQLContext> {
  const rateLimitFields = extractRateLimitFields(schema);

  return {
    async requestDidStart() {
      return {
        async didResolveOperation(ctx) {
          if (rateLimitFields.size === 0) return;
          if (!ctx.operation) return;

          const fragmentMap = new Map<string, FragmentDefinitionNode>();
          for (const def of ctx.document.definitions) {
            if (def.kind === Kind.FRAGMENT_DEFINITION) {
              fragmentMap.set(def.name.value, def);
            }
          }

          await checkSelections(
            ctx.operation.selectionSet.selections,
            fragmentMap,
            new Set(),
            rateLimitFields,
            ctx,
          );
        },
      };
    },
  };
}
