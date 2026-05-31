import { z } from "zod";

export const envSchema = z.object({
  // Server
  PORT: z.coerce.number().int().min(3000).max(65535),
  NODE_ENV: z.enum(["development", "production", "test"]),

  // PostgreSQL
  POSTGRES_HOST: z.string().min(1),
  POSTGRES_PORT: z.coerce.number().int().min(1).max(65535),
  POSTGRES_DB: z.string().min(1),
  POSTGRES_USER: z.string().min(1),
  POSTGRES_PASSWORD: z.string().min(1),

  // Redis
  REDIS_HOST: z.string().min(1),
  REDIS_PORT: z.coerce.number().int().min(1).max(65535),
  REDIS_PASSWORD: z.string().optional(),

  // MongoDB
  MONGO_URI: z.string().min(1),
  MONGO_DB: z.string().min(1),

  // Auth
  API_SECRET_KEY: z.string().min(16),

  // JWT
  JWT_USER_SECRET: z.string().min(32),
  JWT_ADMIN_SECRET: z.string().min(32),
  JWT_ISSUER: z.string().url(),

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
});

export type EnvConfig = z.infer<typeof envSchema>;
