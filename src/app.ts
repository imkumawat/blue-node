import express from "express";
import type { Express, Request, Response, NextFunction } from "express";
import helmet from "helmet";
import cookieParser from "cookie-parser";
import swaggerUi from "swagger-ui-express";

import requestId from "./app-middlewares/requestId.js";
import { requestLogger } from "./app-middlewares/requestLogger.js";
import responseInterceptor from "./app-middlewares/responseInterceptor.js";
import { createHttpLogger } from "./app-middlewares/httpLogger.js";
import { createCorsMiddleware } from "./app-middlewares/cors.js";
import { createBodyParser } from "./app-middlewares/bodyParser.js";
import serviceAvailability from "./app-middlewares/serviceAvailability.js";
import { swaggerAuth } from "./app-middlewares/swaggerAuth.js";
import errorHandler from "./app-middlewares/errorHandler.js";

import { createRateLimiters } from "./shared/middlewares/rateLimiter.js";
import { optionalAuthenticate } from "./shared/middlewares/optionalAuthenticate.js";
import { NotFoundError } from "./shared/errors/NotFoundError.js";

import healthRoute from "./routes/healthRoute.js";
import { createMasterRouter } from "./routes/masterRoutes.js";

import { createGraphQLMiddleware } from "./graphql/server.js";
import {
  authenticateMcp,
  createMcpMetadataRouter,
  createMcpMiddleware,
} from "./mcp/index.js";
import { createOauthRouter } from "./modules/oauth/apis/routes.js";

import { createSwaggerSpec } from "./config/swagger.js";
import { getEnvConfig } from "./config/env.js";

export async function buildApp(): Promise<Express> {
  const { proxy, jwt, env, mcp } = getEnvConfig();
  const isProd = env === "production";
  const graphqlMiddleware = await createGraphQLMiddleware();
  const { ipLimiter } = createRateLimiters();

  const app = express();
  // proxy.hopCount: 0 = no proxy (dev), 1 = ALB only, 2 = CF+ALB etc.
  app.set("trust proxy", proxy.hopCount);

  // compression skipped — handled at ALB level to avoid app-level CPU overhead

  app.use(
    helmet({
      hsts: {
        maxAge: 63072000, // 2 years — minimum for preload-list submission
        includeSubDomains: true,
        preload: isProd,
      },
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          imgSrc: ["'self'", "data:"],
          connectSrc: ["'self'"],
          frameAncestors: ["'none'"],
          objectSrc: ["'none'"],
          upgradeInsecureRequests: isProd ? [] : null,
        },
      },
      referrerPolicy: { policy: "strict-origin-when-cross-origin" },
    }),
  );

  app.use(requestId);
  app.use(requestLogger);
  app.use(responseInterceptor);
  app.use(createHttpLogger({ slowThresholdMs: 500 }));

  const corsMiddleware = createCorsMiddleware();
  app.use(corsMiddleware);
  app.options(/.*/, corsMiddleware);

  app.use(createBodyParser());
  app.use(cookieParser());
  app.use(ipLimiter);
  app.use(healthRoute);
  app.use(serviceAvailability);

  app.use(
    "/api-docs",
    helmet({ contentSecurityPolicy: false }), // Swagger UI needs inline scripts
    swaggerAuth,
    swaggerUi.serve,
    swaggerUi.setup(createSwaggerSpec()),
  );

  app.use("/api/graphql", optionalAuthenticate(), graphqlMiddleware);

  // MCP transport. Flag-gated: with MCP_ENABLED=false nothing is mounted, and the
  // factory guards below (which throw on a missing MCP_RESOURCE_URI) never run.
  if (mcp.enabled) {
    // Metadata first, and deliberately public — a client fetches it precisely
    // because it has no token yet. Behind the auth guard it would be unreachable
    // and OAuth discovery could never start.
    app.use(createMcpMetadataRouter());

    // Authorization server: /authorize, /token, /register and the RFC 8414
    // metadata document. Mounted before the MCP endpoint and outside its auth
    // guard — a client reaches these precisely because it has no token yet.
    app.use(createOauthRouter());

    // app.all, not app.post: GET and DELETE have to reach the handler so it can
    // answer 405 itself, which the transport spec requires. With app.post they
    // would fall through to the catch-all 404 instead.
    //
    // TODO(rate limit): no per-user limiter here yet — a dedicated mcpLimiter is
    // planned. The global ipLimiter above still applies, so the spec's "rate
    // limit tool invocations" is only partly satisfied until then.
    app.all(mcp.path, authenticateMcp(), createMcpMiddleware());
  }

  // Master Routes Registry
  app.use("/api", createMasterRouter());

  // Catch-all: no route matched → 404 via errorHandler (consistent JSON envelope)
  app.use((req: Request, _res: Response, next: NextFunction): void => {
    next(
      new NotFoundError(
        `The requested URL was not found on this server: ${req.method} ${req.originalUrl}`,
      ),
    );
  });

  app.use(errorHandler);

  return app;
}
