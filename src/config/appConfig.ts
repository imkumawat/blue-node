export const REDIS_KEYS = {
  permPrefix: "perms:",
  blacklist: "bl:",
  rlIp: "rl:ip:",
  rlUser: "rl:user:",
  rlApiKey: "rl:apikey:",
  rlAuth: "rl:auth:",
  authFail: "auth:fail:",
  authFailIp: "auth:failip:",
  authFailPair: "auth:failpair:",
  emailVerify: "verify:email:", // email-verification code (stored hashed)
  passwordReset: "reset:password:", // password-reset code (stored hashed)
  jobDone: "job:done:", // idempotency marker — a job that completed (dispatchJob)
  wsUser: "ws:user:", // per-user WebSocket pub/sub channel (cross-instance fan-out)
  wsRoom: "ws:room:", // per-room WebSocket pub/sub channel (cross-instance fan-out)
  // Revoked OAuth grant. Written when a user removes an app's access, with TTL =
  // access-token lifetime: deleting the grant kills its refresh tokens instantly
  // via the FK cascade, but already-issued access tokens are stateless JWTs that
  // would otherwise stay valid until they expire. Once the TTL passes no token
  // from that grant can exist, so the key expires on its own.
  grantRevoked: "oauth:grant:revoked:",
  oauthCode: "oauth:code:", // authorization code — stored hashed, consumed atomically
  oauthPending: "oauth:pending:", // /authorize request held between GET and POST
  // Opaque access token, keyed by SESSION id rather than by a hash of the token.
  // tokenStore.ts explains the choice: revoking a device has to address its
  // session directly, and a key derived from a token we never kept cannot be
  // rebuilt from a session id alone.
  accessToken: "at:",
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

export const GRAPHQL = {
  maxDepth: 5, // reject queries nested deeper than this (depth-limit)
  maxComplexity: 1000, // reject queries whose estimated cost exceeds this
} as const;

export const JWT = {
  adminAudience: "nodeforge:admin",
  userAudience: "nodeforge:user",
  userAccessExpiry: 900, // 15 min — short window; rely on refresh rotation
  userRefreshExpiry: 604800, // 7d
  adminAccessExpiry: 3600, // 1h
  adminRefreshExpiry: 7200, // 2h

  // Asymmetric signing, for tokens a party other than us has to verify.
  // Kept in this block rather than a "jose" one on purpose: naming a config
  // group after the library would make the name a lie the day the library
  // changes.
  //
  // `alg` is a constant, not an env var: it has to move in lockstep with the key
  // material (an RSA key cannot sign ES256), so an independent switch would only
  // ever let the two drift apart.
  alg: "RS256",

  // Seconds of clock skew tolerated on verify. Fleets drift; 0 produces 401s
  // that reproduce nowhere.
  clockToleranceSec: 5,

  // Where the public keys are served. A PUBLIC CONTRACT once it is advertised
  // as `jwks_uri` in the authorization server metadata document.
  jwksPath: "/.well-known/jwks.json",

  // How long a verifier may cache the JWKS. This value sets the floor on a key
  // rotation: after publishing a new key you must wait at least this long before
  // signing with it, or a verifier holding a stale copy sees an unknown `kid`.
  // Kept short for that reason — the cost is one small fetch every few minutes.
  jwksCacheMaxAgeSec: 300, // 5 min
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

export const WS = {
  // Single source of truth for WS paths — used both to gate the upgrade and to
  // branch in handleUpgrade. Same server/port, different auth treatment.
  paths: { authenticated: "/api/ws", public: "/public-ws" },
  maxPayloadBytes: 16 * 1024, // 16KB — reject huge inbound frames
  heartbeatIntervalMs: 30_000, // ping sweep + token-expiry/liveness check cadence
  maxBufferedBytes: 1024 * 1024, // 1MB outbound backlog cap — past this the client is too slow → terminate (it reconnects + resyncs)
  maxConnections: 10_000, // per-instance guardrail vs OOM — tune via load test; scale horizontally past it
} as const;

export const MCP = {
  // Single source of truth for the two client-facing paths. Both are a public
  // contract: changing either breaks every connector a user has already added.
  path: "/mcp",
  wellKnownPath: "/.well-known/oauth-protected-resource/mcp",

  // Identity advertised in `initialize` → result.serverInfo.
  serverName: "blue-node",
  serverVersion: "1.0.0",

  // Optional `instructions` field of the initialize result: server-level guidance
  // that lands in the model's context for the whole session. Used here to close
  // the failure mode the tool design already guards against — a model inventing
  // or asking for an account id when identity always comes from the token.
  instructions:
    "Tools on this server always act on the signed-in user's own account. " +
    "Identity comes from the access token, so no tool takes a user or account " +
    "id — never ask the person for one.",

  // Tool results are fed into the model's context window, not shown to a person.
  // Cap them so one broad query can't burn the whole context.
  maxToolResultChars: 20_000,
} as const;

export const TOKENS = {
  // Visible prefixes, Stripe/GitHub style (sk_live_, ghp_). They carry no secret;
  // the value is that a leaked token is greppable in logs and recognisable by
  // shape without a lookup.
  //
  // A PUBLIC CONTRACT: changing one invalidates every live token of that kind,
  // the same way changing a Redis key prefix would.
  accessPrefix: "nf_at_",
  refreshPrefix: "nf_rt_",

  // First-party session lifetimes. Kept here rather than under JWT because an
  // opaque token has no signature and no claims — nothing about its lifetime is
  // a JWT concern.
  accessExpiry: 900, // 15 min — short window; rely on refresh rotation
  refreshExpiry: 604800, // 7d — also how long a device session may live
} as const;

export const OAUTH = {
  // Client-facing endpoint paths. Advertised verbatim in the authorization
  // server metadata document, so changing one breaks every client that has
  // already discovered it.
  authorizePath: "/oauth/authorize",
  tokenPath: "/oauth/token",
  registerPath: "/oauth/register",
  metadataPath: "/.well-known/oauth-authorization-server",

  // Authorization codes are redeemed within seconds of issue — one redirect hop.
  // OAuth 2.1 caps them at 10 minutes and says "as short as possible"; 60s is
  // ample and keeps the replay window tiny.
  authCodeTtlSec: 60,

  // A user has to read the consent screen, and may have to log in first. Long
  // enough for that, short enough that an abandoned authorization disappears.
  pendingAuthTtlSec: 600,

  // How long an access token issued to a client lives. Here rather than under
  // JWT because it is a delegation decision — how long a third-party app may act
  // for a user — while JWT holds the signing concerns (alg, kid, JWKS).
  accessTokenTtlSec: 900, // 15 min — short window; the client refreshes

  // Visible prefix for a grant's refresh token, kept DISTINCT from the
  // first-party one. Two token families that look alike can be presented at the
  // wrong endpoint and be rejected only by accident — a different prefix makes
  // that a parse failure instead.
  refreshPrefix: "nf_grt_",

  // SLIDING lifetime: how long a connection may sit idle before the app has to
  // be re-authorized.
  refreshTokenTtlSec: 2_592_000, // 30d

  // ABSOLUTE ceiling, fixed when the connection is created. Without it an app
  // that refreshes on schedule never has to ask for consent again.
  refreshTokenAbsoluteTtlSec: 15_552_000, // 180d
} as const;

export const MQTT = {
  connectTimeoutMs: 10_000, // bound the initial connect / each reconnect attempt
  reconnectPeriodMs: 5_000, // auto-reconnect cadence after a drop (0 disables)
  keepaliveSec: 30, // ping cadence — broker marks the client dead past ~1.5x this
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
