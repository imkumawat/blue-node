import type { ApolloServerPlugin } from "@apollo/server";
import logger from "../../utils/logger.js";
import type { GraphQLContext } from "../buildContext.js";

/**
 * Apollo plugin that emits one log line per GraphQL operation with
 * operationName, durationMs, errorCount, and error codes.
 *
 * Uses ctx.logger (set in buildContext) so requestId auto-correlates.
 *
 * Log level decision:
 *   - errors present  → warn
 *   - duration > slow → warn
 *   - otherwise       → info
 *
 * Grep one operation by `operation:"Login"` to see latency over time;
 * filter `level>=40` for slow ops + errors for alerting dashboards.
 */
export function createObservabilityPlugin({
  slowThresholdMs = 500,
}: { slowThresholdMs?: number } = {}): ApolloServerPlugin<GraphQLContext> {
  return {
    async requestDidStart() {
      const start = process.hrtime.bigint();

      return {
        async willSendResponse(ctx) {
          const durationMs = Number(process.hrtime.bigint() - start) / 1e6;
          const slow = durationMs > slowThresholdMs;
          const errorCount = ctx.errors?.length ?? 0;
          const errorCodes =
            errorCount > 0
              ? (ctx.errors ?? []).map((e) => e.extensions?.code ?? "UNKNOWN")
              : null;

          const level: "warn" | "info" =
            errorCount > 0 || slow ? "warn" : "info";

          const log = ctx.contextValue?.logger ?? logger;
          log[level](
            {
              operation: ctx.request?.operationName ?? null,
              durationMs: +durationMs.toFixed(2),
              slow,
              errorCount,
              errorCodes,
            },
            "graphql operation",
          );
        },
      };
    },
  };
}
