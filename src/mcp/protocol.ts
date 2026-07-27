/**
 * Wire-level protocol constants for the MCP endpoint.
 *
 * Implements MCP revision 2025-06-18. Keep that pinned here: it is the baseline
 * a future reader diffs the spec against when deciding what a newer revision
 * actually changed.
 *
 * These are a client contract, not tunables — the same reason WS close codes
 * live in websocket/protocol.ts instead of appConfig. Changing a value here
 * changes what every already-connected client sees.
 */

/** Revision this server implements and reports back in `initialize`. */
export const PROTOCOL_VERSION = "2025-06-18";

/**
 * Revisions this server can actually speak. Only list what is implemented —
 * advertising a revision we don't honour is worse than not advertising it.
 */
export const SUPPORTED_PROTOCOL_VERSIONS = [PROTOCOL_VERSION] as const;

export type SupportedProtocolVersion =
  (typeof SUPPORTED_PROTOCOL_VERSIONS)[number];

/**
 * Picks the revision to answer `initialize` with.
 *
 * A client states the revision it wants. If we speak it, echo it back; if we
 * don't, answer with ours and let the client decide whether to continue. We
 * never reject on mismatch — that rule is what keeps an older client working
 * against a newer server, and it is the easiest thing to get wrong by
 * hardcoding a single version and comparing for equality.
 */
export function negotiateProtocolVersion(requested: unknown): string {
  if (typeof requested !== "string") return PROTOCOL_VERSION;

  const supported: readonly string[] = SUPPORTED_PROTOCOL_VERSIONS;
  return supported.includes(requested) ? requested : PROTOCOL_VERSION;
}

/**
 * Header the client sends on every request after initialize.
 *
 * Express lowercases incoming header names, so this is the lookup key rather
 * than the wire casing (`MCP-Protocol-Version`). An unsupported value MUST be
 * answered with 400 — see server.ts.
 */
export const PROTOCOL_VERSION_HEADER = "mcp-protocol-version";

/** Methods this server handles. Anything else answers method-not-found. */
export type McpMethod =
  | "initialize"
  | "notifications/initialized"
  | "ping"
  | "tools/list"
  | "tools/call";

/** Standard JSON-RPC 2.0 error codes (the only ones a tools-only server needs). */
export const JSON_RPC_ERRORS = {
  parseError: -32700,
  invalidRequest: -32600,
  methodNotFound: -32601,
  invalidParams: -32602,
  internalError: -32603,
} as const;

/**
 * A call that should never have been made.
 *
 * The spec splits tool failures into two buckets: PROTOCOL errors (unknown tool,
 * invalid arguments, server errors) and TOOL EXECUTION errors (`isError: true` —
 * API failures, bad data, business-logic failures). The dividing line is whether
 * the tool ran: arguments that don't match the advertised inputSchema are the
 * client's mistake, since it held the schema, so they belong in the first bucket
 * and must surface as a JSON-RPC error rather than a result the model reads.
 *
 * Deliberately NOT an HttpError subclass — defineTool maps HttpError to an
 * isError result, and this must bypass that.
 */
export class McpProtocolError extends Error {
  code: number;

  constructor(code: number, message: string) {
    super(message);
    this.name = "McpProtocolError";
    this.code = code;
  }
}

/** A content block in a tool result. Text is the only kind we emit today. */
export interface McpTextContent {
  type: "text";
  text: string;
}

/**
 * What `tools/call` returns.
 *
 * `isError: true` is a TOOL-level failure — the call was well formed, the tool
 * ran and failed, and the model is expected to read the message and react (try
 * different arguments, tell the user). That is different from a JSON-RPC error,
 * which means the request itself was malformed or the server broke. Sending a
 * JSON-RPC error where a tool error belongs hides the reason from the model.
 */
export interface McpToolResult {
  content: McpTextContent[];
  isError?: boolean;
}

/** A tool as advertised in `tools/list`. */
export interface McpToolDescriptor {
  name: string;
  description: string;
  /** JSON Schema — produced from the tool's zod schema by defineTool. */
  inputSchema: Record<string, unknown>;
  /**
   * Behaviour hints. Purely advisory metadata, but clients use them to decide
   * what to auto-approve — a readOnlyHint tool can run without prompting the
   * user, a destructiveHint one should not.
   */
  annotations?: {
    readOnlyHint?: boolean;
    destructiveHint?: boolean;
    idempotentHint?: boolean;
    openWorldHint?: boolean;
  };
}
