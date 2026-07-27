import type { RequestHandler } from "express";
import { StatusCodes } from "http-status-codes";

import { getEnvConfig } from "../config/env.js";
import { buildContext } from "./buildContext.js";
import type { McpContext } from "./buildContext.js";
import {
  JSON_RPC_ERRORS,
  McpProtocolError,
  PROTOCOL_VERSION_HEADER,
  SUPPORTED_PROTOCOL_VERSIONS,
  negotiateProtocolVersion,
} from "./protocol.js";
import { failure, parseMessage, success } from "./jsonrpc.js";
import type { JsonRpcId, JsonRpcResponse } from "./jsonrpc.js";
import { assertUniqueToolNames, findTool, listToolsFor } from "./registry.js";

/**
 * The MCP endpoint — a JSON-RPC dispatcher over Streamable HTTP.
 *
 * Implements the request/response half of the transport only: every POST gets a
 * single `application/json` reply. No SSE, which means no server-initiated
 * notifications, no progress events and no resumability — all of which need a
 * held-open stream. The spec explicitly allows a server to answer with one JSON
 * object instead, and a tools-only server has nothing to push.
 *
 * Stateless: no session is issued, so nothing is held between requests and any
 * instance behind the load balancer can serve any call. No sticky sessions.
 *
 * Mounted BEHIND authenticateMcp — buildContext asserts an authenticated user.
 */
export function createMcpMiddleware(): RequestHandler {
  // Boot-time invariant: a duplicate tool name would silently shadow the earlier
  // tool, so fail while starting rather than serve a half-broken registry.
  assertUniqueToolNames();

  const { cors } = getEnvConfig();
  const allowedOrigins = cors.allowedOrigins.split(",").map((o) => o.trim());

  return async (req, res) => {
    // Spec MUST: validate Origin to block DNS rebinding. Same allowlist REST and
    // GraphQL use. An absent Origin is fine — non-browser clients omit it, and
    // this endpoint is Bearer-only, so there are no ambient credentials a page
    // could ride on (the reason the WS layer had to be stricter).
    const origin = req.headers.origin;
    if (origin && !allowedOrigins.includes(origin)) {
      res.status(StatusCodes.FORBIDDEN).end();
      return;
    }

    if (req.method !== "POST") {
      // A GET would open an SSE stream; a DELETE would terminate a session. We
      // offer neither, and 405 is exactly what the spec prescribes for a server
      // that doesn't.
      res.status(StatusCodes.METHOD_NOT_ALLOWED).end();
      return;
    }

    // Spec MUST: an invalid or unsupported MCP-Protocol-Version is a 400.
    //
    // Deliberate deviation: when the header is ABSENT the spec says to assume
    // 2025-03-26. We don't implement that revision, and rejecting every request
    // that omits the header would break clients for no gain — so an absent
    // header is treated as our own version.
    const declaredVersion = req.headers[PROTOCOL_VERSION_HEADER];
    if (declaredVersion !== undefined && !isSupportedVersion(declaredVersion)) {
      res
        .status(StatusCodes.BAD_REQUEST)
        .json(
          failure(
            null,
            JSON_RPC_ERRORS.invalidRequest,
            `Unsupported ${PROTOCOL_VERSION_HEADER}: ${String(declaredVersion)}`,
          ),
        );
      return;
    }

    const message = parseMessage(req.body);

    if (message.kind === "invalid") {
      res
        .status(StatusCodes.BAD_REQUEST)
        .json(
          failure(message.id, JSON_RPC_ERRORS.invalidRequest, message.message),
        );
      return;
    }

    if (message.kind === "notification") {
      // Spec MUST: 202 with no body. `notifications/initialized` arrives here and
      // needs no handling — there is no per-session state to advance.
      res.status(StatusCodes.ACCEPTED).end();
      return;
    }

    const ctx = buildContext(req);
    res.json(await respondTo(message.method, message.params, message.id, ctx));
  };
}

function isSupportedVersion(header: string | string[]): boolean {
  // A repeated header arrives as an array — anomalous, and there is no single
  // version to honour, so treat it as unsupported rather than picking one.
  if (typeof header !== "string") return false;
  return (SUPPORTED_PROTOCOL_VERSIONS as readonly string[]).includes(header);
}

async function respondTo(
  method: string,
  params: unknown,
  id: JsonRpcId,
  ctx: McpContext,
): Promise<JsonRpcResponse> {
  try {
    switch (method) {
      case "initialize":
        return success(id, initializeResult(params));

      case "ping":
        // Liveness only — the spec's result is an empty object.
        return success(id, {});

      case "tools/list":
        return success(id, { tools: listToolsFor(ctx) });

      case "tools/call": {
        const call = readToolCall(params);
        if (!call) {
          return failure(
            id,
            JSON_RPC_ERRORS.invalidParams,
            'tools/call requires a string "name" parameter',
          );
        }

        const tool = findTool(call.name);
        if (!tool) {
          // An unknown TOOL is a bad parameter, not an unknown method — the
          // method exists and routed fine.
          return failure(
            id,
            JSON_RPC_ERRORS.invalidParams,
            `Unknown tool: ${call.name}`,
          );
        }

        // defineTool owns scope and argument validation and converts any failure
        // into an isError result, so a tool reaching here does not throw.
        return success(id, await tool.execute(call.args, ctx));
      }

      default:
        return failure(
          id,
          JSON_RPC_ERRORS.methodNotFound,
          `Unknown method: ${method}`,
        );
    }
  } catch (err) {
    // A call that should never have been made (bad arguments against the
    // advertised schema). Its message is written for the client, so pass it
    // through rather than masking it.
    if (err instanceof McpProtocolError) {
      return failure(id, err.code, err.message);
    }

    // Last resort. Log the real cause, tell the client nothing about it — the
    // same masking errorHandler applies before returning a 500.
    ctx.logger.error({ err, method }, "MCP request failed unexpectedly");
    return failure(id, JSON_RPC_ERRORS.internalError, "Internal server error");
  }
}

function initializeResult(params: unknown): Record<string, unknown> {
  const { mcp } = getEnvConfig();

  let requested: unknown;
  if (
    typeof params === "object" &&
    params !== null &&
    "protocolVersion" in params
  ) {
    requested = params.protocolVersion;
  }

  return {
    protocolVersion: negotiateProtocolVersion(requested),
    serverInfo: { name: mcp.serverName, version: mcp.serverVersion },
    // Only `tools`, and without `listChanged` — declaring that sub-capability
    // would promise notifications/tools/list_changed, which needs an SSE stream
    // we don't open. Declaring resources or prompts would be worse still: a
    // client would call methods that can only answer method-not-found.
    capabilities: { tools: {} },
    instructions: mcp.instructions,
  };
}

function readToolCall(params: unknown): { name: string; args: unknown } | null {
  if (typeof params !== "object" || params === null) return null;
  if (!("name" in params) || typeof params.name !== "string") return null;

  // `arguments` is absent for a no-argument tool; defineTool treats undefined
  // as {}.
  const args = "arguments" in params ? params.arguments : undefined;
  return { name: params.name, args };
}
