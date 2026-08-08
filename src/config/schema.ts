import { z } from "zod";
import type { JWK } from "jose";

export const envSchema = z.object({
  // Server
  PORT: z.coerce.number().int().min(3000).max(65535),
  WORKER_PORT: z.coerce.number().int().min(3000).max(65535).default(3001),
  CRON_PORT: z.coerce.number().int().min(3000).max(65535).default(3002),
  NODE_ENV: z.enum(["development", "production", "test"]),

  // PostgreSQL
  POSTGRES_HOST: z.string().min(1),
  POSTGRES_PORT: z.coerce.number().int().min(1).max(65535),
  POSTGRES_DB: z.string().min(1),
  POSTGRES_USER: z.string().min(1),
  POSTGRES_PASSWORD: z.string().min(1),
  POSTGRES_SSL: z.enum(["true", "false"]).default("false"),
  // PEM contents of the RDS CA bundle (not a path — containers inject it via
  // Secrets Manager). When set with POSTGRES_SSL=true the server certificate
  // is verified (MITM-safe). When omitted, TLS still encrypts the wire but the
  // cert is NOT verified — encryption without authentication.
  POSTGRES_SSL_CA: z.string().optional(),

  // Redis (cache / rate-limit — uses an eviction policy)
  REDIS_HOST: z.string().min(1),
  REDIS_PORT: z.coerce.number().int().min(1).max(65535),
  REDIS_PASSWORD: z.string().optional(),

  // BullMQ Redis — needs a SEPARATE instance with maxmemory-policy=noeviction
  // (cache eviction would silently drop queued jobs). Optional: falls back to
  // the cache Redis above when unset (dev convenience). See .env for the why.
  REDIS_BULL_HOST: z.string().min(1).optional(),
  REDIS_BULL_PORT: z.coerce.number().int().min(1).max(65535).optional(),
  REDIS_BULL_PASSWORD: z.string().optional(),

  // MongoDB
  MONGO_URI: z.string().min(1),
  MONGO_DB: z.string().min(1),

  // MQTT (EMQX broker) — delivery-tracking transport. Non-core: the app boots
  // and serves even if the broker is down (only the delivery feature degrades),
  // but the URL itself is required config. Username/password optional — a dev
  // broker may allow anonymous; prod sets credentials.
  MQTT_URL: z.string().min(1), // e.g. mqtt://localhost:1883 (native) or wss://broker/mqtt (browser)
  MQTT_USERNAME: z.string().optional(),
  MQTT_PASSWORD: z.string().optional(),

  // The value an access token's `aud` claim must equal. RFC 8707 says a resource
  // indicator SHOULD be a URI (in prod: https://api.blue-node.dev/mcp), but it is
  // matched as an opaque string — in dev point it at the existing JWT audience so
  // the aud check stays real against tokens this app already issues.
  MCP_RESOURCE_URI: z.string().min(1),
  OAUTH_SERVER_URL: z.url(),

  // Auth
  API_SECRET_KEY: z.string().min(16),

  // CAPTCHA (Cloudflare Turnstile) — feature-flagged; OFF = inert
  CAPTCHA_ENABLED: z.enum(["true", "false"]).default("false"),
  TURNSTILE_SECRET: z.string().optional(),

  // Email (SendGrid) — optional: only the flag-gated verify/OTP flows use it,
  // so the app boots without it; sendEmail() throws a clear error if unset.
  // EMAIL_FROM must be a SendGrid Single-Sender verified address.
  SENDGRID_API_KEY: z.string().optional(),
  EMAIL_FROM: z.email().optional(),

  // JWT
  JWT_USER_SECRET: z.string().min(32),
  JWT_ADMIN_SECRET: z.string().min(32),
  JWT_ISSUER: z.string().url(),

  /**
   * Private signing keys as a JSON array of JWKs, NEWEST FIRST — the first entry
   * signs, the rest stay only so tokens issued before the last rotation still
   * verify. Rotation is therefore: prepend the new key, deploy, and drop the old
   * one once every token it signed has expired.
   *
   * JWK rather than PEM because a PEM's newlines do not survive an env var
   * intact, while a JWK is a single line of JSON.
   *
   * Validated only far enough to catch a config mistake; jose does the real
   * cryptographic validation when it imports these at boot.
   */
  JWT_SIGNING_KEYS: z.string().transform((raw, ctx): JWK[] => {
    let parsed: unknown;

    try {
      parsed = JSON.parse(raw);
    } catch {
      ctx.addIssue({ code: "custom", message: "must be valid JSON" });
      return z.NEVER;
    }

    if (!Array.isArray(parsed) || parsed.length === 0) {
      ctx.addIssue({
        code: "custom",
        message: "must be a non-empty JSON array of JWKs",
      });
      return z.NEVER;
    }

    const everyEntryLooksLikeAJwk = parsed.every(
      (entry) =>
        typeof entry === "object" &&
        entry !== null &&
        typeof (entry as { kty?: unknown }).kty === "string",
    );

    if (!everyEntryLooksLikeAJwk) {
      ctx.addIssue({
        code: "custom",
        message: "every entry must be a JWK object with a string `kty`",
      });
      return z.NEVER;
    }

    return parsed as JWK[];
  }),

  // Opaque tokens
  // Pepper for access-token HMACs. Deliberately separate from the JWT secrets:
  // it signs nothing, it only makes a stored digest useless on its own. Kept in
  // config and never written to Redis, so a Redis dump alone cannot be used to
  // verify guesses offline.
  TOKEN_PEPPER: z.string().min(32),

  // Swagger
  SWAGGER_USER: z.string().min(1).optional(),
  SWAGGER_PASSWORD: z.string().min(8).optional(),

  // AWS S3
  S3_BUCKET_UPLOADS: z.string().min(1),
  S3_BUCKET_REPORTS: z.string().min(1),

  // AWS SQS
  SQS_QUEUE_URL_NOTIFICATIONS: z.string().url(),
  SQS_QUEUE_URL_REPORTS: z.string().url(),
  SQS_QUEUE_URL_EMAILS: z.string().url(),

  // CloudFront
  CLOUDFRONT_KEY_PAIR_ID: z.string().min(1),
  CLOUDFRONT_PRIVATE_KEY: z.string().min(1),
  CLOUDFRONT_DOMAIN_CDN: z.string().min(1),
  CLOUDFRONT_DISTRIBUTION_ID_CDN: z.string().min(1),
  CLOUDFRONT_DOMAIN_REPORTS: z.string().min(1),
  CLOUDFRONT_DISTRIBUTION_ID_REPORTS: z.string().min(1),

  // CORS
  ALLOWED_ORIGINS: z.string().min(1),

  // App
  API_BASE_URL: z.string().url(),
  PROXY_HOP_COUNT: z.coerce.number().int().min(0).max(10),

  // GraphQL (optional — fall back to appConfig.GRAPHQL defaults)
  GRAPHQL_MAX_DEPTH: z.coerce.number().int().min(1).max(20).optional(),
  GRAPHQL_MAX_COMPLEXITY: z.coerce.number().int().min(1).optional(),
});

export type EnvConfig = z.infer<typeof envSchema>;
