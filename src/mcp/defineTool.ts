import { z } from "zod";

import { getEnvConfig } from "../config/env.js";
import { HttpError } from "../shared/errors/HttpError.js";
import { ForbiddenError } from "../shared/errors/ForbiddenError.js";
import type { Scope } from "../shared/constants/scopes.js";
import type { McpContext } from "./buildContext.js";
import { JSON_RPC_ERRORS, McpProtocolError } from "./protocol.js";
import type { McpToolDescriptor, McpToolResult } from "./protocol.js";

/** What a module author writes to declare one tool. */
export interface ToolSpec<TInput extends z.ZodObject> {
  /** Wire name the model calls. snake_case and stable — renaming breaks callers. */
  name: string;
  /**
   * Read by the MODEL to decide whether to call this tool, so it is a prompt,
   * not documentation. Say what it does AND when to reach for it.
   */
  description: string;
  /**
   * Scope the token must carry. Mandatory on purpose: taking it here means a
   * tool cannot be declared without stating who may call it. Checking inside
   * the handler is the same thing minus the guarantee.
   *
   * Typed to the SCOPES catalog rather than `string` — a mandatory field that
   * accepts any typo'd value is a weak guarantee, and a new capability should
   * force a deliberate addition to the catalog.
   */
  scope: Scope;
  /** Argument schema — doubles as the advertised JSON Schema and the validator. */
  input: TInput;
  /** Advisory hints clients use to decide what to auto-approve. */
  annotations?: McpToolDescriptor["annotations"];
  /**
   * Runs the tool. Receives validated, defaults-applied arguments.
   *
   * Return the text the model should read. Throw to fail: an HttpError's message
   * is passed through (those are written for callers), anything else is logged
   * and replaced with a generic message so internals never reach the model.
   */
  handler: (input: z.infer<TInput>, ctx: McpContext) => Promise<string>;
}

/** A registered tool: what to advertise, and how to run it safely. */
export interface McpTool {
  name: string;
  /** Exposed so tools/list can hide tools the caller's token cannot use. */
  scope: Scope;
  descriptor: McpToolDescriptor;
  execute(args: unknown, ctx: McpContext): Promise<McpToolResult>;
}

export function defineTool<TInput extends z.ZodObject>(
  spec: ToolSpec<TInput>,
): McpTool {
  const descriptor: McpToolDescriptor = {
    name: spec.name,
    description: spec.description,
    // `io: "input"` is load-bearing: in output mode a field with .default() is
    // reported as required, so the model would be told to always send it.
    inputSchema: z.toJSONSchema(spec.input, { io: "input" }),
  };

  if (spec.annotations) {
    descriptor.annotations = spec.annotations;
  }

  async function execute(
    args: unknown,
    ctx: McpContext,
  ): Promise<McpToolResult> {
    try {
      // Authorization first: cheapest check, and an unauthorized caller should
      // learn nothing about the argument shape. tools/list already hides tools
      // the token can't use — this is the enforcement, not a duplicate of it.
      if (!ctx.session.scopes.includes(spec.scope)) {
        throw new ForbiddenError(
          `Tool "${spec.name}" requires the "${spec.scope}" scope`,
        );
      }

      // `args` is MODEL output, not human input. Untrusted either way.
      // A no-argument tool is called with `arguments` omitted entirely, so an
      // absent value legitimately means "{}" — don't fail a valid call over it.
      const parsed = spec.input.safeParse(args ?? {});
      if (!parsed.success) {
        const detail = parsed.error.issues
          .map(
            (issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`,
          )
          .join("; ");

        // A protocol error, not a tool result: the client advertised schema said
        // what to send, so arguments that don't match are its mistake and the
        // tool never ran. See McpProtocolError for the spec's two buckets.
        throw new McpProtocolError(
          JSON_RPC_ERRORS.invalidParams,
          `Invalid arguments for "${spec.name}": ${detail}`,
        );
      }

      return toolText(await spec.handler(parsed.data, ctx));
    } catch (err) {
      // Protocol errors are not tool failures — let them bubble to the dispatcher,
      // which turns them into a JSON-RPC error. Checked first, before HttpError,
      // so this never gets flattened into an isError result.
      if (err instanceof McpProtocolError) throw err;

      if (err instanceof HttpError) {
        // Domain errors carry messages meant for a caller, and the model can act
        // on them — fix the arguments, or tell the user why it couldn't be done.
        ctx.logger.warn(
          { tool: spec.name, code: err.code },
          "MCP tool returned a domain error",
        );
        return toolError(err.message);
      }

      // Anything else is a bug. Log the stack, hand the model a generic message —
      // the same masking errorHandler applies before returning a 500.
      ctx.logger.error(
        { err, tool: spec.name },
        "MCP tool threw an unexpected error",
      );
      return toolError(`Tool "${spec.name}" failed unexpectedly`);
    }
  }

  return { name: spec.name, scope: spec.scope, descriptor, execute };
}

function toolText(text: string): McpToolResult {
  return { content: [{ type: "text", text: capText(text) }] };
}

/**
 * A failed tool call is still a SUCCESSFUL JSON-RPC response carrying
 * `isError: true`. That is deliberate: the model reads the message and can
 * recover. A JSON-RPC error would surface as a transport failure and the reason
 * would never reach the model.
 */
function toolError(message: string): McpToolResult {
  return { content: [{ type: "text", text: capText(message) }], isError: true };
}

/**
 * Tool results are fed into the model's context window. Read the cap at call
 * time rather than at import so config stays mockable and load order can't bite.
 */
function capText(text: string): string {
  const { maxToolResultChars } = getEnvConfig().mcp;
  if (text.length <= maxToolResultChars) return text;

  // Tell the model what to do about it, not just that it happened.
  return `${text.slice(0, maxToolResultChars)}\n\n[truncated at ${maxToolResultChars} characters — narrow the filters or paginate]`;
}
