import { ApolloServer } from "@apollo/server";
import { expressMiddleware } from "@as-integrations/express5";
import { mergeTypeDefs, mergeResolvers } from "@graphql-tools/merge";
import { makeExecutableSchema } from "@graphql-tools/schema";
import depthLimit from "graphql-depth-limit";
import type { RequestHandler } from "express";

import { baseTypeDefs } from "./baseTypeDefs.js";
import { authTypeDefs } from "../modules/auth/graphql-apis/typedefs.js";
import { authResolvers } from "../modules/auth/graphql-apis/resolvers.js";
import { formatError } from "./formatError.js";
import { createDisableAliasingPlugin } from "./plugins/disableAliasing.js";
import { createComplexityPlugin } from "./plugins/queryComplexity.js";
import { createObservabilityPlugin } from "./plugins/observability.js";
import { authenticatedDirectiveTransformer } from "./directives/authenticatedDirective.js";
import { requireScopeDirectiveTransformer } from "./directives/requireScopeDirective.js";
import { authRateLimitDirectiveTransformer } from "./directives/authRateLimitDirective.js";
import { rateLimitDirectiveTransformer } from "./directives/rateLimitDirective.js";
import { buildContext } from "./buildContext.js";
import type { GraphQLContext } from "./buildContext.js";
import { getEnvConfig } from "../config/env.js";

const typeDefs = mergeTypeDefs([baseTypeDefs, authTypeDefs]);
const resolvers = mergeResolvers([authResolvers]);

// Build the executable schema, then apply the auth/authz directive transformers.
// Each wraps the resolver of every field tagged @authenticated / @requireScope,
// so enforcement is bound to the exact (type, field) — no field-name collision.
let schema = makeExecutableSchema({ typeDefs, resolvers });
schema = authenticatedDirectiveTransformer(schema);
schema = requireScopeDirectiveTransformer(schema);
// Rate-limit transformers applied last → they wrap outermost (run first), so
// flood/abuse checks happen before auth/resolver work. authRateLimit applied
// before rateLimit so the general limiter runs first (matches the prior order).
schema = authRateLimitDirectiveTransformer(schema);
schema = rateLimitDirectiveTransformer(schema);

export async function createGraphQLMiddleware(): Promise<RequestHandler> {
  const { maxDepth, maxComplexity } = getEnvConfig().graphql;

  const server = new ApolloServer<GraphQLContext>({
    schema,
    formatError,
    introspection: process.env.NODE_ENV !== "production",
    includeStacktraceInErrorResponses: false,
    validationRules: [depthLimit(maxDepth)],
    csrfPrevention: true,
    plugins: [
      createObservabilityPlugin({ slowThresholdMs: 500 }),
      createDisableAliasingPlugin(schema),
      createComplexityPlugin(schema, maxComplexity),
    ],
  });

  await server.start();

  return expressMiddleware(server, { context: buildContext });
}
