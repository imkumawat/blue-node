export const REDIS_KEYS = {
  permPrefix: "perms:",
  blacklist: "bl:",
  rlIp: "rl:ip:",
  rlUser: "rl:user:",
  rlApiKey: "rl:apikey:",
  rlAuth: "rl:auth:",
  refreshRotated: "refresh:rotated:",
  authFail: "auth:fail:",
} as const;

export const REDIS = {
  retryBaseMs: 500,
  retryMaxMs: 5000,
  permTtl: 900, // 15 min
} as const;

export const RATE_LIMIT = {
  windowMs: 15 * 60 * 1000, // 15 min
  maxIp: 500, // covers shared IPs (office/university), blocks DDoS
  maxUser: 300, // covers heavy dashboard usage (~20 req/min)
  maxApiKey: 1000, // covers bulk API integrations (~66 req/min)
  maxAuth: 10, // per IP on auth routes — only failed attempts count
} as const;

export const JWT = {
  adminAudience: "nodeforge:admin",
  userAudience: "nodeforge:user",
  userAccessExpiry: 900, // 15 min — short window; rely on refresh rotation
  userRefreshExpiry: 604800, // 7d
  adminAccessExpiry: 3600, // 1h
  adminRefreshExpiry: 7200, // 2h
} as const;

export const AUTH = {
  saltRounds: 12,
  apiKeyPrefix: "nf_",
  maxFailedLogins: 5, // distributed-attack defense — locks account after N failed attempts regardless of source IP
  lockoutWindowSec: 15 * 60, // 15 min — counter TTL; passing this without further failure clears the count
} as const;

export const HEALTH = {
  timeoutMs: 3000,
} as const;

export const BODY = {
  sizeLimit: "1mb",
} as const;

export const ROUTES = {
  webhookPrefix: "/api/webhooks/",
} as const;

export const AWS = {
  s3: {
    signedUrlExpiry: 86_400, // 24h — private file access
    presignedUrlExpiry: 900, // 15min — FE direct upload
  },
  sqs: {
    visibilityTimeout: 30, // seconds — message hidden after receive
    waitTime: 20, // seconds — long polling
    maxMessages: 10, // max per receive call
  },
  cloudfront: {
    signedUrlExpiry: 86_400, // 24h — private file/CDN access
    signedCookieExpiry: 3_600, // 1h — multi-file session access
  },
} as const;
