import pino from "pino";

// Pretty logs ONLY in an interactive terminal (local laptop). On AWS/Docker/CI
// stdout is piped (not a TTY) → raw JSON for CloudWatch/Datadog. This is
// NODE_ENV-independent, so even a deployed "development" env logs raw JSON.
const usePretty = process.stdout.isTTY === true;

const logger = pino({
  level: process.env.LOG_LEVEL ?? "info",
  transport: usePretty
    ? {
        target: "pino-pretty",
        options: { colorize: true, translateTime: "HH:MM:ss.l" },
      }
    : undefined,
  redact: {
    paths: [
      // Request headers
      "req.headers.authorization",
      "req.headers.cookie",
      'req.headers["x-csrf-token"]',
      'req.headers["x-api-key"]',
      'req.headers["x-auth-token"]',

      // Response headers
      'res.headers["set-cookie"]',

      // Request body — credentials
      "req.body.password",
      "req.body.confirmPassword",
      "req.body.currentPassword",
      "req.body.newPassword",
      "req.body.token",
      "req.body.accessToken",
      "req.body.refreshToken",
      "req.body.apiKey",
      "req.body.secret",

      // Request body — PII
      "req.body.email",

      // Axios-style outgoing errors
      "err.config.headers.authorization",
      "err.config.headers.cookie",
      'err.response.headers["set-cookie"]',
      "err.request.headers.authorization",

      // Top-level safety net
      "password",
      "passwordHash",
      "confirmPassword",
      "currentPassword",
      "newPassword",
      "accessToken",
      "refreshToken",
      "token",
      "apiKey",
      "secret",
      "privateKey",
      "email",

      // One-level nested
      "*.password",
      "*.passwordHash",
      "*.confirmPassword",
      "*.accessToken",
      "*.refreshToken",
      "*.token",
      "*.apiKey",
      "*.secret",
      "*.privateKey",
      "*.email",
    ],
    censor: "[REDACTED]",
  },
});

export default logger;
