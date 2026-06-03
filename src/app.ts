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

import { createSwaggerSpec } from "./config/swagger.js";
import { getEnvConfig } from "./config/env.js";

export async function buildApp(): Promise<Express> {
  const { proxy, jwt, env } = getEnvConfig();
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

  app.use(
    "/api/graphql",
    optionalAuthenticate(jwt.userAudience),
    graphqlMiddleware,
  );

  // Master Routes Registry
  app.use("/api", createMasterRouter());

  // Catch-all: no route matched → 404 via errorHandler (consistent JSON envelope)
  app.use((req: Request, _res: Response, next: NextFunction): void => {
    next(
      new NotFoundError(`Route not found: ${req.method} ${req.originalUrl}`),
    );
  });

  app.use(errorHandler);

  return app;
}
