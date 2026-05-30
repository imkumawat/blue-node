import { envSchema } from "./schema.js";
import type { EnvConfig } from "./schema.js";
import logger from "../utils/logger.js";
import {
  JWT,
  REDIS,
  REDIS_KEYS,
  RATE_LIMIT,
  AUTH,
  HEALTH,
  BODY,
  ROUTES,
  AWS,
  POSTGRES_POOL,
} from "./appConfig.js";
import { fetchSecrets } from "../lib/aws/secrets.js";

export type AppConfig = {
  env: EnvConfig["NODE_ENV"];
  server: { port: number };
  apiBaseUrl: string;
  apiSecret: string;
  postgres: {
    host: string;
    port: number;
    name: string;
    user: string;
    password: string;
    pool: typeof POSTGRES_POOL;
  };
  redis: {
    host: string;
    port: number;
    password: string | undefined;
    retryBaseMs: number;
    retryMaxMs: number;
    permTtl: number;
    connectTimeoutMs: number;
    commandTimeoutMs: number;
    keepAliveMs: number;
    keys: typeof REDIS_KEYS;
  };
  jwt: {
    userSecret: string;
    adminSecret: string;
    issuer: string;
    adminAudience: string;
    userAudience: string;
    userAccessExpiry: number;
    userRefreshExpiry: number;
    adminAccessExpiry: number;
    adminRefreshExpiry: number;
  };
  swagger: { user: string | undefined; password: string | undefined };
  cors: { allowedOrigins: string };
  proxy: { hopCount: number };
  rateLimit: typeof RATE_LIMIT;
  auth: typeof AUTH;
  health: typeof HEALTH;
  body: typeof BODY;
  routes: typeof ROUTES;
  aws: {
    s3: typeof AWS.s3 & {
      buckets: { uploads: string; reports: string };
    };
    sqs: typeof AWS.sqs & {
      queues: { notifications: string; reports: string; emails: string };
    };
    cloudfront: typeof AWS.cloudfront & {
      keyPairId: string;
      privateKey: string;
      distributions: {
        cdn: { domain: string; distributionId: string };
        reports: { domain: string; distributionId: string };
      };
    };
  };
};

let _config: AppConfig | null = null;

export function getEnvConfig(): AppConfig {
  if (!_config) {
    throw new Error("Config not initialized. Call loadEnv() first.");
  }
  return _config;
}

export default async function loadEnv(
  override?: AppConfig,
): Promise<AppConfig> {
  // Test-injection path — skip dotenv / AWS Secrets / Zod validation entirely.
  // Caller is responsible for providing a fully-shaped config object.
  if (override) {
    _config = override;
    return _config;
  }

  const SECRET_NAME = process.env.AWS_SECRET_NAME;

  if (SECRET_NAME) {
    try {
      const secrets = await fetchSecrets(SECRET_NAME);
      Object.assign(process.env, secrets);
      logger.info("AWS Secrets Manager: secrets loaded");
    } catch (err) {
      logger.fatal(
        { err: err instanceof Error ? err.message : String(err) },
        "Failed to load AWS secrets",
      );
      process.exit(1);
    }
  } else {
    // Local dev only — .env file not available in Fargate
    const { default: dotenv } = await import("dotenv");
    dotenv.config();
    logger.info("dotenv: .env loaded (local dev)");
  }

  const result = envSchema.safeParse(process.env);
  if (!result.success) {
    logger.fatal(
      { errors: result.error.flatten().fieldErrors },
      "Invalid environment config",
    );
    process.exit(1);
  }

  const e = result.data;

  _config = {
    env: e.NODE_ENV,
    server: { port: e.PORT },
    apiBaseUrl: e.API_BASE_URL,
    apiSecret: e.API_SECRET_KEY,
    postgres: {
      host: e.POSTGRES_HOST,
      port: e.POSTGRES_PORT,
      name: e.POSTGRES_DB,
      user: e.POSTGRES_USER,
      password: e.POSTGRES_PASSWORD,
      pool: POSTGRES_POOL,
    },
    redis: {
      host: e.REDIS_HOST,
      port: e.REDIS_PORT,
      password: e.REDIS_PASSWORD,
      ...REDIS,
      keys: REDIS_KEYS,
    },
    jwt: {
      userSecret: e.JWT_USER_SECRET,
      adminSecret: e.JWT_ADMIN_SECRET,
      issuer: e.JWT_ISSUER,
      ...JWT,
    },
    swagger: {
      user: e.SWAGGER_USER,
      password: e.SWAGGER_PASSWORD,
    },
    cors: { allowedOrigins: e.ALLOWED_ORIGINS },
    proxy: { hopCount: e.PROXY_HOP_COUNT },
    rateLimit: RATE_LIMIT,
    auth: AUTH,
    health: HEALTH,
    body: BODY,
    routes: ROUTES,
    aws: {
      s3: {
        ...AWS.s3,
        buckets: {
          uploads: e.S3_BUCKET_UPLOADS,
          reports: e.S3_BUCKET_REPORTS,
        },
      },
      sqs: {
        ...AWS.sqs,
        queues: {
          notifications: e.SQS_QUEUE_URL_NOTIFICATIONS,
          reports: e.SQS_QUEUE_URL_REPORTS,
          emails: e.SQS_QUEUE_URL_EMAILS,
        },
      },
      cloudfront: {
        ...AWS.cloudfront,
        keyPairId: e.CLOUDFRONT_KEY_PAIR_ID,
        privateKey: e.CLOUDFRONT_PRIVATE_KEY,
        distributions: {
          cdn: {
            domain: e.CLOUDFRONT_DOMAIN_CDN,
            distributionId: e.CLOUDFRONT_DISTRIBUTION_ID_CDN,
          },
          reports: {
            domain: e.CLOUDFRONT_DOMAIN_REPORTS,
            distributionId: e.CLOUDFRONT_DISTRIBUTION_ID_REPORTS,
          },
        },
      },
    },
  };

  return _config;
}
