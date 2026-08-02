import { authMcpTools } from "../modules/auth/mcp-apis/tools.js";
import type { Scope } from "../shared/constants/scopes.js";
import type { McpTool } from "./defineTool.js";
import type { McpContext } from "./buildContext.js";
import type { McpToolDescriptor } from "./protocol.js";

/**
 * Every tool the server exposes.
 *
 * Modules spread their tool arrays here — the same shape as masterRoutes for
 * REST and mergeTypeDefs for GraphQL. Adding a module means one import and one
 * spread; nothing else in the transport changes.
 *
 * Imported straight from each module's mcp-apis/ directory, the same way
 * graphql/server.ts reaches graphql-apis/typedefs.js. Routing these through the
 * module's index.ts barrel instead would drag the whole tool graph into every
 * barrel consumer — the REST auth middleware and the WS router only want
 * verifyToken, and the barrel is curated precisely to keep it that way.
 */
const ALL_TOOLS: McpTool[] = [...authMcpTools];

const TOOLS_BY_NAME: Map<string, McpTool> = new Map(
  ALL_TOOLS.map((tool) => [tool.name, tool]),
);

/**
 * Scopes advertised in the protected-resource document.
 *
 * Derived from the registered tools, not from the full SCOPES catalog: this field
 * means "scopes you can ask for on THIS resource". Advertising admin_access when
 * no tool uses it would put it on the user's consent screen for nothing.
 */
export const SUPPORTED_SCOPES: Scope[] = [
  ...new Set(ALL_TOOLS.map((tool) => tool.scope)),
];

/**
 * Fails when two modules register the same tool name.
 *
 * Called from the MCP boot guard rather than run at import: a duplicate would
 * otherwise silently shadow the earlier tool, but throwing at module load is
 * hard to test around and fires before the app can log anything useful. Keeping
 * it with the other boot-time MCP invariants puts them all in one place.
 */
export function assertUniqueToolNames(): void {
  const seen = new Set<string>();
  const duplicates = new Set<string>();

  for (const tool of ALL_TOOLS) {
    if (seen.has(tool.name)) duplicates.add(tool.name);
    seen.add(tool.name);
  }

  if (duplicates.size > 0) {
    throw new Error(
      `MCP registry has duplicate tool names: ${[...duplicates].join(", ")}`,
    );
  }
}

/**
 * The tools this caller may actually use.
 *
 * Filtering by granted scope is NOT the authorization check — defineTool still
 * enforces the scope on every call. This exists so the model never sees a tool
 * it cannot use, and doesn't burn a turn calling something that can only come
 * back forbidden.
 */
export function listToolsFor(ctx: McpContext): McpToolDescriptor[] {
  return ALL_TOOLS.filter((tool) =>
    ctx.session.scopes.includes(tool.scope),
  ).map((tool) => tool.descriptor);
}

export function findTool(name: string): McpTool | undefined {
  return TOOLS_BY_NAME.get(name);
}
