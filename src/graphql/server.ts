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
import { createAuthPlugin } from "./plugins/auth.js";
import { createRateLimitPlugin } from "./plugins/rateLimit.js";
import { createAuthRateLimitPlugin } from "./plugins/authRateLimit.js";
import { buildContext } from "./buildContext.js";
import type { GraphQLContext } from "./buildContext.js";

const typeDefs = mergeTypeDefs([baseTypeDefs, authTypeDefs]);
const resolvers = mergeResolvers([authResolvers]);
const schema = makeExecutableSchema({ typeDefs, resolvers });

export async function createGraphQLMiddleware(): Promise<RequestHandler> {
  const server = new ApolloServer<GraphQLContext>({
    schema,
    formatError,
    introspection: process.env.NODE_ENV !== "production",
    includeStacktraceInErrorResponses: false,
    validationRules: [depthLimit(5)],
    csrfPrevention: true,
    plugins: [
      createObservabilityPlugin({ slowThresholdMs: 500 }),
      createDisableAliasingPlugin(schema),
      createComplexityPlugin(schema, 1000),
      createAuthPlugin(schema),
      createRateLimitPlugin(schema),
      createAuthRateLimitPlugin(schema),
    ],
  });

  await server.start();

  return expressMiddleware(server, { context: buildContext });
}
