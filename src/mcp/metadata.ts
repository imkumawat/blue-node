import { Router } from "express";
import type { Router as ExpressRouter } from "express";

import { getEnvConfig } from "../config/env.js";
import logger from "../utils/logger.js";
import { SUPPORTED_SCOPES } from "./registry.js";

/**
 * OAuth protected-resource metadata (RFC 9728).
 *
 * One public GET that tells a client which authorization server issues tokens for
 * this resource. It is the second half of the discovery handshake: the 401 from
 * authenticateMcp points here, and this points at the AS.
 *
 * Must be reachable WITHOUT a token — a client fetches it precisely because it
 * has none. Mount it before any auth guard.
 *
 * `authorization_servers` is what decouples this server from whoever mints the
 * tokens. Today MCP_AUTH_SERVER_URL points back at this app; when a real
 * authorization server exists, only that env value changes.
 */
export function createMcpMetadataRouter(): ExpressRouter {
  const { mcp } = getEnvConfig();
  if (!mcp.resourceUri) {
    throw new Error("MCP_RESOURCE_URI must be set when MCP_ENABLED=true");
  }

  if (!mcp.authServerUrl) {
    // Not fatal, unlike a missing resourceUri: nothing becomes insecure, the
    // discovery chain just dead-ends and no client can complete an OAuth flow.
    logger.warn(
      "MCP_AUTH_SERVER_URL is unset — protected-resource metadata will omit authorization_servers and clients cannot discover an authorization server",
    );
  }

  const document: Record<string, unknown> = {
    resource: mcp.resourceUri,
    bearer_methods_supported: ["header"],
    scopes_supported: SUPPORTED_SCOPES,
  };

  // Omitted entirely when unset rather than sent as null or an empty array — a
  // client reading an empty list concludes "this resource has no authorization
  // server", which is a different and more confusing failure than "this document
  // is incomplete".
  if (mcp.authServerUrl) {
    document.authorization_servers = [mcp.authServerUrl];
  }

  const router = Router();

  // Built once above, served as-is: the document is derived purely from config
  // and the registered tools, neither of which changes at runtime.
  router.get(mcp.wellKnownPath, (_req, res) => {
    res.json(document);
  });

  return router;
}
