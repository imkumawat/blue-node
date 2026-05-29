import swaggerJsdoc from "swagger-jsdoc";
import type { Options } from "swagger-jsdoc";
import { getEnvConfig } from "./env.js";

export function createSwaggerSpec(): object {
  const { apiBaseUrl, env } = getEnvConfig();

  // swagger-jsdoc pulls in an outdated @apidevtools/json-schema-ref-parser that uses
  // the deprecated url.parse() — suppress until upstream fixes the dependency
  const original = process.emitWarning.bind(process);
  process.emitWarning = ((warning: unknown, ...args: unknown[]): void => {
    if (typeof warning === "string" && warning.includes("url.parse")) return;
    (original as (...a: unknown[]) => void)(warning, ...args);
  }) as typeof process.emitWarning;

  const options: Options = {
    definition: {
      openapi: "3.0.0",
      info: {
        title: "blue-node API",
        version: "1.0.0",
        description: "blue-node backend API documentation",
      },
      servers: [{ url: apiBaseUrl, description: env }],
      components: {
        securitySchemes: {
          bearerAuth: {
            type: "http",
            scheme: "bearer",
            bearerFormat: "JWT",
          },
        },
      },
    },
    apis: env === "production" ? ["./dist/routes/*.js"] : ["./src/routes/*.ts"],
  };

  return swaggerJsdoc(options);
}
