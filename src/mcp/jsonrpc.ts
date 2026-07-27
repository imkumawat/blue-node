/**
 * JSON-RPC 2.0 envelope for the MCP transport.
 *
 * MCP speaks JSON-RPC 2.0. This file owns the envelope only: turning an incoming
 * body into a shape the dispatcher can switch on, and building well-formed
 * replies. It knows nothing about MCP methods or tools.
 *
 * Batching (an array of messages) was REMOVED in revision 2025-06-18, so an
 * array body is rejected rather than iterated.
 *
 * On -32700 (parse error): the app-level body parser runs before this and
 * rejects malformed JSON with the standard HTTP error envelope, so a real parse
 * failure never reaches here. The code stays in JSON_RPC_ERRORS as part of the
 * standard table; if a strict JSON-RPC parse error is ever wanted, mount a
 * dedicated parser on the MCP path instead of relying on the global one.
 */

export const JSON_RPC_VERSION = "2.0";

/** A request id is a string or a number. `null` appears only in error replies. */
export type JsonRpcId = string | number;

export interface JsonRpcSuccess {
  jsonrpc: typeof JSON_RPC_VERSION;
  id: JsonRpcId;
  result: unknown;
}

export interface JsonRpcFailure {
  jsonrpc: typeof JSON_RPC_VERSION;
  id: JsonRpcId | null;
  error: { code: number; message: string; data?: unknown };
}

export type JsonRpcResponse = JsonRpcSuccess | JsonRpcFailure;

/**
 * The three things an incoming body can turn out to be.
 *
 * A notification (no id) must NOT get a response body — the HTTP transport
 * answers 202 Accepted and nothing else. Replying to one makes the client treat
 * the reply as an answer to some other request.
 */
export type ParsedMessage =
  | { kind: "request"; id: JsonRpcId; method: string; params: unknown }
  | { kind: "notification"; method: string; params: unknown }
  | { kind: "invalid"; id: JsonRpcId | null; message: string };

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isJsonRpcId(value: unknown): value is JsonRpcId {
  return typeof value === "string" || typeof value === "number";
}

/**
 * Validates the envelope — NOT the params.
 *
 * Strict about structure (`jsonrpc`, `method`, `id`), deliberately indifferent to
 * anything else: unknown extra fields are ignored, never rejected. That split is
 * what keeps this server working when a later revision adds a field — being
 * liberal means ignoring what you don't know, not accepting a broken envelope.
 */
export function parseMessage(body: unknown): ParsedMessage {
  if (Array.isArray(body)) {
    return {
      kind: "invalid",
      id: null,
      message: "Batched requests are not supported in this protocol revision",
    };
  }

  if (!isPlainObject(body)) {
    return {
      kind: "invalid",
      id: null,
      message: "Request body must be a JSON object",
    };
  }

  // Read the id up front so even a rejection can be correlated by the client.
  const hasId = "id" in body && body.id !== undefined;
  const id = isJsonRpcId(body.id) ? body.id : null;

  if (body.jsonrpc !== JSON_RPC_VERSION) {
    return {
      kind: "invalid",
      id,
      message: `"jsonrpc" must be "${JSON_RPC_VERSION}"`,
    };
  }

  if (typeof body.method !== "string" || body.method.length === 0) {
    return {
      kind: "invalid",
      id,
      message: `"method" must be a non-empty string`,
    };
  }

  // No id at all → notification. Fire-and-forget, no reply.
  if (!hasId) {
    return { kind: "notification", method: body.method, params: body.params };
  }

  // An id was sent but isn't a string or number. Not a notification — the client
  // is waiting for a reply, so say what's wrong instead of silently dropping it.
  if (id === null) {
    return {
      kind: "invalid",
      id: null,
      message: `"id" must be a string or a number`,
    };
  }

  return { kind: "request", id, method: body.method, params: body.params };
}

export function success(id: JsonRpcId, result: unknown): JsonRpcSuccess {
  return { jsonrpc: JSON_RPC_VERSION, id, result };
}

export function failure(
  id: JsonRpcId | null,
  code: number,
  message: string,
  data?: unknown,
): JsonRpcFailure {
  return {
    jsonrpc: JSON_RPC_VERSION,
    id,
    error: data === undefined ? { code, message } : { code, message, data },
  };
}
