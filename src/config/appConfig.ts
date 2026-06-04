export const REDIS_KEYS = {
  permPrefix: "perms:",
  blacklist: "bl:",
  rlIp: "rl:ip:",
  rlUser: "rl:user:",
  rlApiKey: "rl:apikey:",
  rlAuth: "rl:auth:",
  refreshRotated: "refresh:rotated:",
  authFail: "auth:fail:",
  authFailIp: "auth:failip:",
  authFailPair: "auth:failpair:",
  emailVerify: "verify:email:", // email-verification code (stored hashed)
} as const;

export const REDIS = {
  retryBaseMs: 500,
  retryMaxMs: 5000,
  permTtl: 900, // 15 min
  connectTimeoutMs: 10_000, // boot-time TCP connect cap
  commandTimeoutMs: 5_000, // per-command timeout — bounds hang during failover
  keepAliveMs: 30_000, // TCP keepalive so dead conns surface quickly
} as const;

export const POSTGRES_POOL = {
  max: 20, // per-instance pool size; coordinate with Postgres max_connections
  min: 2, // keep warm connections, avoid cold-start latency
  idleTimeoutMillis: 30_000, // recycle stale conns; defends against server-side age
  connectionTimeoutMillis: 5_000, // bound wait for pool slot — fail fast over hang
  statementTimeoutMs: 30_000, // server-side query kill (Postgres statement_timeout)
  queryTimeoutMs: 30_000, // client-side query cancel — defense in depth
  applicationName: "blue-node", // visible in pg_stat_activity for debugging
} as const;

export const MONGO = {
  maxPoolSize: 20, // per-instance connection pool ceiling
  minPoolSize: 2, // keep warm conns, avoid cold-start latency
  serverSelectionTimeoutMs: 5_000, // fail fast if no reachable node
  connectTimeoutMs: 10_000, // TCP connect cap
  socketTimeoutMs: 30_000, // per-op socket inactivity cap
  appName: "blue-node", // visible in Mongo server logs / profiler
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
  maxFailedLogins: 5, // hard lockout threshold for per-IP and per-(email|ip) counters
  emailSoftWarnThreshold: 20, // per-email — log-only surveillance, does NOT block (prevents account-DoS)
  lockoutWindowSec: 15 * 60, // 15 min — counter TTL; passing this without further failure clears the count
} as const;

export const CAPTCHA = {
  failThreshold: 3, // per-IP failures → require CAPTCHA (below the hard-lock at maxFailedLogins=5)
  verifyUrl: "https://challenges.cloudflare.com/turnstile/v0/siteverify", // Turnstile siteverify (fixed vendor endpoint)
} as const;

// Shared one-time-code settings — email verification now, device-2FA later.
export const OTP = {
  codeLength: 6,
  ttlSec: 10 * 60, // 10 min — code validity window
  maxAttempts: 5, // wrong-code tries before the code is invalidated
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

export const AWS_HTTP = {
  connectionTimeoutMs: 3_000, // TCP connect cap — fail fast on network issue
  requestTimeoutMs: 10_000, // per-request total cap (raise for S3 uploads if needed)
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
