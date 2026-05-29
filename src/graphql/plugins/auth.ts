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
import { InvalidTokenError } from "../../modules/auth/errors.js";
import { ForbiddenError } from "../../shared/errors/ForbiddenError.js";
import type { GraphQLContext } from "../buildContext.js";

interface AuthRule {
  authenticated: boolean;
  scope: string | null;
}

function directiveArg(
  directive: DirectiveNode,
  argName: string,
): string | null {
  const arg = directive.arguments?.find((a) => a.name.value === argName);
  if (arg && "value" in arg.value) return String(arg.value.value);
  return null;
}

function extractAuthRules(schema: GraphQLSchema): Map<string, AuthRule> {
  const fields = new Map<string, AuthRule>();
  for (const type of Object.values(schema.getTypeMap())) {
    if (type.name.startsWith("__")) continue;
    if (!("getFields" in type)) continue;
    for (const field of Object.values(type.getFields())) {
      const directives = field.astNode?.directives ?? [];
      const authedDir = directives.find(
        (d: DirectiveNode) => d.name.value === "authenticated",
      );
      const scopeDir = directives.find(
        (d: DirectiveNode) => d.name.value === "requireScope",
      );
      if (!authedDir && !scopeDir) continue;
      fields.set(field.name, {
        authenticated: Boolean(authedDir) || Boolean(scopeDir),
        scope: scopeDir ? directiveArg(scopeDir, "scope") : null,
      });
    }
  }
  return fields;
}

function check(
  rule: AuthRule,
  ctx: GraphQLRequestContextDidResolveOperation<GraphQLContext>,
): void {
  if (rule.authenticated && !ctx.contextValue.user) {
    throw new InvalidTokenError();
  }
  if (
    rule.scope &&
    !(ctx.contextValue.user?.scopes ?? []).includes(rule.scope)
  ) {
    throw new ForbiddenError(`Missing required scope: ${rule.scope}`);
  }
}

function checkSelections(
  selections: readonly SelectionNode[],
  fragmentMap: Map<string, FragmentDefinitionNode>,
  visited: Set<string>,
  rules: Map<string, AuthRule>,
  ctx: GraphQLRequestContextDidResolveOperation<GraphQLContext>,
): void {
  for (const sel of selections) {
    if (sel.kind === Kind.FIELD) {
      const rule = rules.get(sel.name.value);
      if (rule) check(rule, ctx);
      if (sel.selectionSet) {
        checkSelections(
          sel.selectionSet.selections,
          fragmentMap,
          visited,
          rules,
          ctx,
        );
      }
    } else if (sel.kind === Kind.INLINE_FRAGMENT) {
      checkSelections(
        sel.selectionSet.selections,
        fragmentMap,
        visited,
        rules,
        ctx,
      );
    } else if (sel.kind === Kind.FRAGMENT_SPREAD) {
      const name = sel.name.value;
      if (visited.has(name)) continue;
      const frag = fragmentMap.get(name);
      if (!frag) continue;
      visited.add(name);
      checkSelections(
        frag.selectionSet.selections,
        fragmentMap,
        visited,
        rules,
        ctx,
      );
    }
  }
}

export function createAuthPlugin(
  schema: GraphQLSchema,
): ApolloServerPlugin<GraphQLContext> {
  const rules = extractAuthRules(schema);

  return {
    async requestDidStart() {
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

          checkSelections(
            ctx.operation.selectionSet.selections,
            fragmentMap,
            new Set(),
            rules,
            ctx,
          );
        },
      };
    },
  };
}
