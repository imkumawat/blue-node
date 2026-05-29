import { unwrapResolverError } from "@apollo/server/errors";
import type { GraphQLFormattedError } from "graphql";
import { HttpError } from "../shared/errors/HttpError.js";
import logger from "../utils/logger.js";

export function formatError(
  formattedErr: GraphQLFormattedError,
  originalErr: unknown,
): GraphQLFormattedError {
  const err = unwrapResolverError(originalErr);

  if (err instanceof HttpError) {
    return {
      ...formattedErr,
      message: err.message,
      extensions: {
        ...formattedErr.extensions,
        code: err.code,
        statusCode: err.statusCode,
        details: err.details,
      },
    };
  }

  const apolloCode = formattedErr.extensions?.code;
  if (apolloCode && apolloCode !== "INTERNAL_SERVER_ERROR") {
    return formattedErr;
  }

  logger.error({ err: originalErr }, "Unhandled GraphQL error");

  return {
    ...formattedErr,
    message: "Internal server error",
    extensions: { code: "INTERNAL_ERROR", statusCode: 500 },
  };
}
