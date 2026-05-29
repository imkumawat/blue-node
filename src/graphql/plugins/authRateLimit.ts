import { Kind } from "graphql";
import type {
  GraphQLSchema,
  SelectionNode,
  FragmentDefinitionNode,
  DirectiveNode,
} from "graphql";
import type { ApolloServerPlugin } from "@apollo/server";
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

function extractAuthRateLimitFields(
  schema: GraphQLSchema,
): Map<string, RateLimitConfig> {
  const fields = new Map<string, RateLimitConfig>();
  for (const type of Object.values(schema.getTypeMap())) {
    if (type.name.startsWith("__")) continue;
    if (!("getFields" in type)) continue;
    for (const field of Object.values(type.getFields())) {
      const directive = (field.astNode?.directives ?? []).find(
        (d: DirectiveNode) => d.name.value === "authRateLimit",
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

function keyFor(fieldName: string, ctx: GraphQLContext): string {
  const id = ctx.ipAddress ?? "unknown";
  return `rl:gql:authfail:${fieldName}:${id}`;
}

async function precheckCounter(
  fieldName: string,
  config: RateLimitConfig,
  ctx: GraphQLContext,
): Promise<void> {
  const key = keyFor(fieldName, ctx);
  const count = parseInt((await getRedis().get(key)) ?? "0", 10);
  if (count >= config.max) {
    const ttl = await getRedis().ttl(key);
    throw new RateLimitError(ttl > 0 ? ttl : config.windowSec);
  }
}

async function incrementOnFailure(
  fieldName: string,
  config: RateLimitConfig,
  ctx: GraphQLContext,
): Promise<void> {
  const key = keyFor(fieldName, ctx);
  const count = await getRedis().incr(key);
  if (count === 1) await getRedis().expire(key, config.windowSec);
}

function findRequestedProtectedFields(
  selections: readonly SelectionNode[],
  fragmentMap: Map<string, FragmentDefinitionNode>,
  visited: Set<string>,
  ruleSet: Map<string, RateLimitConfig>,
): string[] {
  const found: string[] = [];
  const walk = (selList: readonly SelectionNode[]): void => {
    for (const sel of selList) {
      if (sel.kind === Kind.FIELD) {
        if (ruleSet.has(sel.name.value)) found.push(sel.name.value);
        if (sel.selectionSet) walk(sel.selectionSet.selections);
      } else if (sel.kind === Kind.INLINE_FRAGMENT) {
        walk(sel.selectionSet.selections);
      } else if (sel.kind === Kind.FRAGMENT_SPREAD) {
        const name = sel.name.value;
        if (visited.has(name)) continue;
        const frag = fragmentMap.get(name);
        if (!frag) continue;
        visited.add(name);
        walk(frag.selectionSet.selections);
      }
    }
  };
  walk(selections);
  return found;
}

export function createAuthRateLimitPlugin(
  schema: GraphQLSchema,
): ApolloServerPlugin<GraphQLContext> {
  const rules = extractAuthRateLimitFields(schema);

  return {
    async requestDidStart() {
      let tracked: string[] = [];

      return {
        async didResolveOperation(ctx) {
          if (rules.size === 0) return;
          if (!ctx.operation) return;

          const fragmentMap = new Map<string, FragmentDefinitionNode>();
          for (const def of ctx.document.definitions) {
            if (def.kind === Kind.FRAGMENT_DEFINITION) {
              fragmentMap.set(def.name.value, def);
            }
          }

          const requested = findRequestedProtectedFields(
            ctx.operation.selectionSet.selections,
            fragmentMap,
            new Set(),
            rules,
          );

          for (const fieldName of requested) {
            const config = rules.get(fieldName);
            if (config)
              await precheckCounter(fieldName, config, ctx.contextValue);
          }

          tracked = requested;
        },

        async willSendResponse(ctx) {
          if (tracked.length === 0) return;

          const errors =
            ctx.response.body.kind === "single"
              ? (ctx.response.body.singleResult.errors ?? [])
              : [];

          const errorPaths = new Set<string | number>();
          for (const err of errors) {
            const top = err.path?.[0];
            if (top !== undefined) errorPaths.add(top);
          }
          if (errorPaths.size === 0) return;

          for (const fieldName of tracked) {
            if (errorPaths.has(fieldName)) {
              const config = rules.get(fieldName);
              if (config) {
                await incrementOnFailure(fieldName, config, ctx.contextValue);
              }
            }
          }
        },
      };
    },
  };
}
