// Public surface of the MCP transport. app.ts mounts exactly these three;
// everything else under mcp/ is internal to the transport and must not be
// imported from outside it.
//
// Kept curated (no `export *`) for the same reason the auth module's barrel is:
// the internals — jsonrpc envelope, registry, protocol constants — should stay
// free to move without touching consumers.
export { createMcpMiddleware } from "./server.js";
export { createMcpMetadataRouter } from "./metadata.js";
export { authenticateMcp } from "./authenticate.js";
