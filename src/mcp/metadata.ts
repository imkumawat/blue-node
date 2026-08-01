import { Router } from "express";
import type { Router as ExpressRouter } from "express";

import { getEnvConfig } from "../config/env.js";
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
 * tokens. Today OAUTH_SERVER_URL points back at this app; when a real
 * authorization server exists, only that env value changes.
 */
export function createMcpMetadataRouter(): ExpressRouter {
  const { mcp, oauth } = getEnvConfig();

  const document: Record<string, unknown> = {
    resource: mcp.resourceUri,
    bearer_methods_supported: ["header"],
    scopes_supported: SUPPORTED_SCOPES,
    authorization_servers: [oauth.oauthServerUrl],
  };

  const router = Router();

  // Built once above, served as-is: the document is derived purely from config
  // and the registered tools, neither of which changes at runtime.
  router.get(`${mcp.wellKnownPath}/mcp`, (_req, res) => {
    res.json(document);
  });

  return router;
}
