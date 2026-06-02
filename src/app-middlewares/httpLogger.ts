import { pinoHttp } from "pino-http";
import logger from "../utils/logger.js";
import { getClientIp } from "../utils/getClientIp.js";

export function createHttpLogger({ slowThresholdMs = 500 } = {}) {
  const isSlow = (req: { startTime?: bigint }): boolean => {
    if (!req.startTime) return false;
    const elapsedMs = Number(process.hrtime.bigint() - req.startTime) / 1e6;
    return elapsedMs > slowThresholdMs;
  };

  return pinoHttp({
    logger,
    autoLogging: {
      // /health skipped — ALB hits it every 30s, logging it inflates CloudWatch ingestion cost
      ignore: (req) =>
        req.url === "/health" ||
        req.method === "OPTIONS" ||
        req.method === "HEAD",
    },
    customLogLevel: (req, res, err) => {
      if (err || res.statusCode >= 500) return "error";
      if (res.statusCode >= 400) return "warn";
      if (isSlow(req)) return "warn";
      return "info";
    },
    customProps: (req) => ({
      requestId: req.requestId,
      clientIp: getClientIp(req),
      slow: isSlow(req),
    }),
    serializers: {
      req: (req) => ({
        method: req.method,
        url: req.url?.split("?")[0], // path only — no query params (avoids logging PII)
      }),
      res: (res) => ({
        statusCode: res.statusCode,
      }),
    },
  });
}
