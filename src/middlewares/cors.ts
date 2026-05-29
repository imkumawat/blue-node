import cors from "cors";
import type { CorsOptions } from "cors";
import { getEnvConfig } from "../config/env.js";
import logger from "../utils/logger.js";

export function createCorsMiddleware() {
  const {
    cors: { allowedOrigins: originsStr },
  } = getEnvConfig();
  const allowedOrigins = originsStr.split(",").map((o) => o.trim());

  const options: CorsOptions = {
    origin: (origin, callback) => {
      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        logger.warn({ origin }, "CORS blocked origin");
        callback(null, false);
      }
    },
    credentials: true,
    methods: ["HEAD", "GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: [
      "Content-Type",
      "Authorization",
      "X-Request-ID",
      "X-Platform",
    ],
    optionsSuccessStatus: 200,
  };

  return cors(options);
}
