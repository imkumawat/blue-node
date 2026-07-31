import { z } from "zod";

import { defineTool } from "../../../mcp/defineTool.js";
import type { McpTool } from "../../../mcp/defineTool.js";
import { SCOPES } from "../../../shared/constants/scopes.js";
import { getUserById } from "../services/getUserById.js";

/**
 * MCP tools contributed by the auth module.
 *
 * Thin adapter, exactly like graphql-apis/: defineTool validates at the boundary
 * from the zod schema, we call a service, we format the result. No business
 * logic lives here.
 */

const getProfile = defineTool({
  name: "get_profile",
  description:
    "Get the signed-in user's own account profile — email address, account " +
    "status, and when they joined. Call this when the user asks about their " +
    "own account, their email, or when they signed up.",
  scope: SCOPES.PROFILE_READ,

  // No arguments, deliberately. Identity comes from the access token, never from
  // the model: accepting a userId here would let a prompt-injected model read
  // somebody else's profile. Any tool acting "on me" must take the subject from
  // ctx.user, not from its input.
  input: z.object({}),

  annotations: {
    readOnlyHint: true,
    idempotentHint: true,
    openWorldHint: false,
  },

  handler: async (_input, ctx) => {
    const user = await getUserById(ctx.user.id);

    // Pick fields explicitly. getUserById returns the raw `users` row, which
    // includes passwordHash — spreading it or JSON.stringify-ing it would hand
    // the hash straight to the model. GraphQL has a schema to stop that; here
    // the tool itself is the boundary.
    return [
      `Email: ${user.email}`,
      `Status: ${user.status}`,
      `First Name: ${user.firstName}`,
      `Last Name: ${user.lastName}`,
      `Member since: ${user.createdAt.toISOString().slice(0, 10)}`,
    ].join("\n");
  },
});

export const authMcpTools: McpTool[] = [getProfile];
