import { Kind } from "graphql";
import type {
  GraphQLSchema,
  DirectiveNode,
  OperationDefinitionNode,
  DocumentNode,
  SelectionNode,
  FragmentDefinitionNode,
} from "graphql";

/** Read a directive's string argument by name (null if absent). */
export function getDirectiveArg(
  directive: DirectiveNode,
  argName: string,
): string | null {
  const arg = directive.arguments?.find((a) => a.name.value === argName);
  if (arg && "value" in arg.value) return String(arg.value.value);
  return null;
}

/** Read a directive's integer argument by name (0 if absent). */
export function getDirectiveIntArg(
  directive: DirectiveNode,
  argName: string,
): number {
  const raw = getDirectiveArg(directive, argName);
  return raw === null ? 0 : parseInt(raw, 10);
}

/**
 * Scan every field in the schema for `directiveName`; for each tagged field run
 * `parse(directive)` and collect into a Map keyed by field name. Called once at
 * boot by each plugin — the directive layout is static for the process lifetime.
 */
export function collectFieldsWithDirective<T>(
  schema: GraphQLSchema,
  directiveName: string,
  parse: (directive: DirectiveNode) => T,
): Map<string, T> {
  const out = new Map<string, T>();
  for (const type of Object.values(schema.getTypeMap())) {
    if (type.name.startsWith("__")) continue;
    if (!("getFields" in type)) continue;
    for (const field of Object.values(type.getFields())) {
      const directive = (field.astNode?.directives ?? []).find(
        (d: DirectiveNode) => d.name.value === directiveName,
      );
      if (directive) out.set(field.name, parse(directive));
    }
  }
  return out;
}

/**
 * Walk an operation's selection set (fragment-aware, cycle-safe) and return the
 * names of every selected field present in `match`, in document order,
 * INCLUDING duplicates — an aliased/repeated selection appears once per
 * occurrence. (Aliasing detection relies on the duplicates; the rate-limit and
 * auth plugins act per occurrence, matching their prior behavior.)
 */
export function collectMatchedFields(
  operation: OperationDefinitionNode,
  document: DocumentNode,
  match: { has(name: string): boolean },
): string[] {
  const fragmentMap = new Map<string, FragmentDefinitionNode>();
  for (const def of document.definitions) {
    if (def.kind === Kind.FRAGMENT_DEFINITION) {
      fragmentMap.set(def.name.value, def);
    }
  }

  const found: string[] = [];
  const visited = new Set<string>();

  const walk = (selections: readonly SelectionNode[]): void => {
    for (const sel of selections) {
      if (sel.kind === Kind.FIELD) {
        if (match.has(sel.name.value)) found.push(sel.name.value);
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

  walk(operation.selectionSet.selections);
  return found;
}
