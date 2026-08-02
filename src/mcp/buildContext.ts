import type { Request } from "express";
import type { Logger } from "pino";

import { getClientIp } from "../utils/getClientIp.js";
import type { AuthSession } from "../modules/auth/index.js";

export interface McpContext {
  /**
   * The authenticated principal.
   *
   * Non-nullable by design: authenticateMcp rejects an unauthenticated request
   * with 401 before the dispatcher runs, so there is no anonymous path into a
   * tool. `user.scopes` carries what the token was granted — that is what
   * per-tool authorization reads.
   */
  user: AuthSession;
  ipAddress: string;
  requestId: string;
  logger: Logger;
}

/**
 * Builds the per-request context handed to every MCP tool.
 *
 * Mirrors graphql/buildContext.ts, minus the parts that don't apply: no
 * DataLoaders (tools call services directly instead of resolving a graph), and
 * no jti / refresh-token plumbing (session lifecycle belongs to REST and
 * GraphQL — an MCP client never logs out or rotates a token here).
 *
 * Synchronous on purpose: unlike the GraphQL version, nothing here awaits.
 * Apollo's context contract forces a promise; this has no such requirement.
 *
 * Keep it thin — anything expensive belongs in a service the tool calls.
 */
export function buildContext(req: Request): McpContext {
  if (!req.session) {
    // Not defensive padding — an invariant check. If this ever fires, the mount
    // order in app.ts is wrong (authenticateMcp must run before the dispatcher)
    // and every tool would otherwise execute unauthenticated. Fail loud.
    throw new Error(
      "MCP context built without an authenticated user — check middleware order",
    );
  }

  return {
    user: req.session,
    ipAddress: getClientIp(req),
    requestId: req.requestId!, // set by the requestId middleware, mounted app-wide
    logger: req.logger,
  };
}
