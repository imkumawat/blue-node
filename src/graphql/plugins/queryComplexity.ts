import {
  getComplexity,
  simpleEstimator,
  directiveEstimator,
} from "graphql-query-complexity";
import type { GraphQLSchema } from "graphql";
import type { ApolloServerPlugin } from "@apollo/server";
import { ComplexityLimitError } from "../../shared/errors/ComplexityLimitError.js";
import logger from "../../utils/logger.js";
import type { GraphQLContext } from "../buildContext.js";

export function createComplexityPlugin(
  schema: GraphQLSchema,
  maxComplexity = 1000,
): ApolloServerPlugin<GraphQLContext> {
  return {
    async requestDidStart() {
      return {
        async didResolveOperation({ request, document }) {
          const complexity = getComplexity({
            schema,
            query: document,
            variables: request.variables ?? {},
            estimators: [
              directiveEstimator({ name: "complexity" }),
              simpleEstimator({ defaultComplexity: 1 }),
            ],
          });

          if (complexity > maxComplexity) {
            logger.warn(
              {
                complexity,
                max: maxComplexity,
                operation: request.operationName,
              },
              "Query complexity exceeded",
            );
            throw new ComplexityLimitError(complexity, maxComplexity);
          }
        },
      };
    },
  };
}
