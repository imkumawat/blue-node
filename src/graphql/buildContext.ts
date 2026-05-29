import type { Request } from "express";
import type { Logger } from "pino";
import { getClientIp } from "../utils/getClientIp.js";
import { createLoaders } from "./loaders/index.js";
import type { Loaders } from "./loaders/index.js";
import type { AuthUser } from "../modules/auth/services/verifyToken.js";

export interface GraphQLContext {
  user: AuthUser | null;
  accessJti: string | null;
  accessExp: number | null;
  rawRefreshToken: string | null;
  ipAddress: string;
  userAgent: string | null;
  platform: string;
  requestId: string;
  logger: Logger;
  loaders: Loaders;
}

/**
 * Builds the per-request GraphQL context.
 *
 * Runs once per HTTP request. Return value becomes the 3rd argument (`ctx`)
 * passed to every resolver. Mirrors `req`-like data that Express handlers
 * use directly, but in the resolver-friendly shape.
 *
 * Keep this thin — heavy work (DB lookups, etc.) should go through DataLoaders
 * instantiated here and lazily resolved by resolvers.
 */
export async function buildContext({
  req,
}: {
  req: Request;
}): Promise<GraphQLContext> {
  return {
    user: req.user ?? null,
    accessJti: req.user?.jti ?? null,
    accessExp: req.user?.exp ?? null,
    rawRefreshToken: req.cookies?.refresh_token ?? null,
    ipAddress: getClientIp(req),
    userAgent: req.headers["user-agent"] ?? null,
    platform: (req.headers["x-platform"] as string | undefined) ?? "web",
    requestId: req.requestId!,
    logger: req.logger,
    loaders: createLoaders(),
  };
}
