import pino, { type LoggerOptions } from "pino";

// =============================================================================
// Production logger — pino with curated redaction.
//
// Layered defenses against accidental sensitive-data logging:
//   1. `serializers` for req/res/err → emit only safe, well-known fields.
//      Stops leakage at source when caller logs whole objects.
//   2. `redact.paths` → fast path-based censoring for known sensitive keys
//      across headers, cookies, body, attached user, axios errors, and
//      top-level / one-level-nested generic field names.
//
// Known limitations of pino's path-based redact:
//   • Wildcard `*.field` matches ONE level only. `a.b.c.password` will NOT be
//     caught. Don't pass deeply-nested arbitrary objects to the logger; use
//     a serializer or pre-scrub.
//   • URL-embedded creds (`https://user:pass@host`) are NOT scrubbed.
//   • Generic names like `code`, `state`, `iv`, `salt` are scoped to
//     `req.body.*` only — too many false positives at top-level.
// =============================================================================

const redactPaths: string[] = [
  // ---------------------------------------------------------------------------
  // Request headers
  // ---------------------------------------------------------------------------
  "req.headers.authorization",
  'req.headers["proxy-authorization"]',
  'req.headers["x-forwarded-authorization"]',
  "req.headers.cookie",
  'req.headers["x-csrf-token"]',
  'req.headers["x-xsrf-token"]',
  'req.headers["x-api-key"]',
  'req.headers["x-auth-token"]',
  'req.headers["x-access-token"]',
  'req.headers["x-refresh-token"]',

  // Parsed cookies (cookie-parser)
  "req.cookies",
  "req.signedCookies",

  // ---------------------------------------------------------------------------
  // Response headers
  // ---------------------------------------------------------------------------
  'res.headers["set-cookie"]',

  // ---------------------------------------------------------------------------
  // Request body — credentials
  // ---------------------------------------------------------------------------
  "req.body.password",
  "req.body.confirmPassword",
  "req.body.currentPassword",
  "req.body.newPassword",
  "req.body.token",
  "req.body.accessToken",
  "req.body.refreshToken",
  "req.body.apiKey",
  "req.body.secret",
  "req.body.clientSecret",
  "req.body.authorization",

  // Request body — OTP / MFA
  "req.body.otp",
  "req.body.pin",
  "req.body.mfaCode",
  "req.body.totpCode",
  "req.body.recoveryCode",
  "req.body.securityAnswer",

  // Request body — PII
  "req.body.email",
  "req.body.phone",
  "req.body.phoneNumber",
  "req.body.mobile",
  "req.body.dob",
  "req.body.dateOfBirth",

  // Request body — financial
  "req.body.cardNumber",
  "req.body.cvv",
  "req.body.cardCvv",
  "req.body.accountNumber",
  "req.body.ifsc",
  "req.body.upiId",

  // Request body — India KYC
  "req.body.aadhaar",
  "req.body.aadhar",
  "req.body.pan",
  "req.body.panNumber",
  "req.body.passport",
  "req.body.passportNumber",
  "req.body.drivingLicense",
  "req.body.voterId",
  "req.body.uan",
  "req.body.gstin",
  "req.body.gstNumber",
  "req.body.tan",
  "req.body.cin",
  "req.body.abhaId",

  // Request body — payment processors
  "req.body.stripeToken",
  "req.body.stripeSecret",
  "req.body.razorpayKey",
  "req.body.razorpaySecret",
  "req.body.paymentToken",

  // Request body — push / messaging
  "req.body.fcmToken",
  "req.body.apnsToken",
  "req.body.deviceToken",

  // Request body — OAuth
  "req.body.idToken",
  "req.body.code",
  "req.body.authorization_code",
  "req.body.state",
  "req.body.pkceVerifier",

  // Request body — biometric
  "req.body.fingerprint",
  "req.body.faceData",
  "req.body.biometric",

  // ---------------------------------------------------------------------------
  // req.user — attached by auth middleware
  // ---------------------------------------------------------------------------
  "req.user.password",
  "req.user.passwordHash",

  // ---------------------------------------------------------------------------
  // Axios-style outgoing errors
  // ---------------------------------------------------------------------------
  "err.config.headers.authorization",
  "err.config.headers.cookie",
  'err.response.headers["set-cookie"]',
  "err.response.config.headers.authorization",
  "err.response.data.password",
  "err.response.data.token",
  "err.response.data.accessToken",
  "err.response.data.refreshToken",
  "err.request.headers.authorization",

  // ---------------------------------------------------------------------------
  // Top-level safety net — when an object is logged at root
  // ---------------------------------------------------------------------------
  // Credentials
  "password",
  "passwordHash",
  "confirmPassword",
  "currentPassword",
  "newPassword",
  "accessToken",
  "refreshToken",
  "token",
  "jwt",
  "bearerToken",
  "apiKey",
  "secret",
  "secretKey",
  "accessKey",
  "clientSecret",
  "privateKey",
  "encryptionKey",
  "signingKey",
  "masterKey",
  "webhookSecret",
  "sessionId",
  "credentials",
  "auth",
  "authToken",

  // OTP / MFA
  "otp",
  "pin",
  "mfaCode",
  "totpCode",
  "recoveryCode",
  "securityAnswer",

  // PII
  "email",
  "phone",
  "phoneNumber",
  "mobile",
  "dob",
  "dateOfBirth",

  // Financial
  "cardNumber",
  "cvv",
  "accountNumber",
  "ifsc",
  "upiId",

  // India KYC
  "aadhaar",
  "aadhar",
  "pan",
  "panNumber",
  "passport",
  "passportNumber",
  "drivingLicense",
  "voterId",
  "uan",
  "gstin",
  "gstNumber",
  "tan",
  "cin",
  "abhaId",

  // Cloud / infra
  "awsAccessKeyId",
  "awsSecretAccessKey",
  "gcpServiceAccount",
  "gcpCredentials",
  "azureClientSecret",
  "firebaseConfig",
  "firebaseToken",
  "vercelToken",
  "herokuApiKey",
  "connectionString",
  "databaseUrl",
  "mongoUri",
  "redisUrl",
  "redisPassword",
  "postgresUrl",

  // Crypto / wallets
  "mnemonic",
  "seedPhrase",
  "keystore",
  "walletPrivateKey",

  // SSH / Git
  "sshKey",
  "sshPrivateKey",
  "deployKey",
  "gitToken",
  "githubToken",
  "gitlabToken",

  // CI / registries
  "npmToken",
  "dockerPassword",
  "registryToken",

  // Payment processors
  "stripeToken",
  "stripeSecret",
  "razorpayKey",
  "razorpaySecret",
  "paymentToken",

  // Messaging / email providers
  "slackToken",
  "slackWebhookUrl",
  "discordToken",
  "telegramBotToken",
  "twilioAuthToken",
  "twilioApiKey",
  "sendgridApiKey",
  "mailgunApiKey",

  // Monitoring
  "sentryDsn",
  "datadogApiKey",
  "newRelicLicenseKey",

  // Search / auth providers
  "algoliaApiKey",
  "auth0ClientSecret",
  "oktaToken",

  // Push / device tokens
  "fcmToken",
  "apnsToken",
  "deviceToken",

  // OAuth
  "idToken",
  "authorization_code",
  "pkceVerifier",

  // Biometric
  "fingerprint",
  "faceData",
  "biometric",

  // Encryption material
  "kmsKey",
  "kmsKeyId",
  "pemKey",
  "p12",
  "pfx",

  // CSRF
  "csrfToken",
  "xsrfToken",

  // ---------------------------------------------------------------------------
  // One-level nested wildcard — catches `{ user: { password: ... } }`
  // ---------------------------------------------------------------------------
  "*.password",
  "*.passwordHash",
  "*.confirmPassword",
  "*.currentPassword",
  "*.newPassword",
  "*.accessToken",
  "*.refreshToken",
  "*.token",
  "*.jwt",
  "*.bearerToken",
  "*.apiKey",
  "*.secret",
  "*.secretKey",
  "*.accessKey",
  "*.clientSecret",
  "*.privateKey",
  "*.encryptionKey",
  "*.signingKey",
  "*.masterKey",
  "*.webhookSecret",
  "*.sessionId",
  "*.credentials",
  "*.auth",
  "*.authToken",
  "*.otp",
  "*.pin",
  "*.mfaCode",
  "*.totpCode",
  "*.recoveryCode",
  "*.securityAnswer",
  "*.email",
  "*.phone",
  "*.phoneNumber",
  "*.mobile",
  "*.dob",
  "*.dateOfBirth",
  "*.cardNumber",
  "*.cvv",
  "*.cardCvv",
  "*.accountNumber",
  "*.ifsc",
  "*.upiId",
  "*.aadhaar",
  "*.aadhar",
  "*.pan",
  "*.panNumber",
  "*.passport",
  "*.passportNumber",
  "*.drivingLicense",
  "*.voterId",
  "*.uan",
  "*.gstin",
  "*.gstNumber",
  "*.tan",
  "*.cin",
  "*.abhaId",
  "*.awsAccessKeyId",
  "*.awsSecretAccessKey",
  "*.gcpServiceAccount",
  "*.gcpCredentials",
  "*.azureClientSecret",
  "*.firebaseConfig",
  "*.firebaseToken",
  "*.vercelToken",
  "*.herokuApiKey",
  "*.connectionString",
  "*.databaseUrl",
  "*.mongoUri",
  "*.redisUrl",
  "*.redisPassword",
  "*.postgresUrl",
  "*.mnemonic",
  "*.seedPhrase",
  "*.keystore",
  "*.walletPrivateKey",
  "*.sshKey",
  "*.sshPrivateKey",
  "*.deployKey",
  "*.gitToken",
  "*.githubToken",
  "*.gitlabToken",
  "*.npmToken",
  "*.dockerPassword",
  "*.registryToken",
  "*.stripeToken",
  "*.stripeSecret",
  "*.razorpayKey",
  "*.razorpaySecret",
  "*.paymentToken",
  "*.slackToken",
  "*.slackWebhookUrl",
  "*.discordToken",
  "*.telegramBotToken",
  "*.twilioAuthToken",
  "*.twilioApiKey",
  "*.sendgridApiKey",
  "*.mailgunApiKey",
  "*.sentryDsn",
  "*.datadogApiKey",
  "*.newRelicLicenseKey",
  "*.algoliaApiKey",
  "*.auth0ClientSecret",
  "*.oktaToken",
  "*.fcmToken",
  "*.apnsToken",
  "*.deviceToken",
  "*.idToken",
  "*.authorization_code",
  "*.pkceVerifier",
  "*.fingerprint",
  "*.faceData",
  "*.biometric",
  "*.kmsKey",
  "*.kmsKeyId",
  "*.pemKey",
  "*.p12",
  "*.pfx",
  "*.csrfToken",
  "*.xsrfToken",

  // ---------------------------------------------------------------------------
  // Two-level deep — highest-risk fields only.
  // Wildcards cost more than literal paths (fast-redact walks properties),
  // so this is intentionally a short list: credentials + OTP + card + KYC IDs.
  // Catches shapes like `{ user: { profile: { password } } }`.
  // ---------------------------------------------------------------------------
  "*.*.password",
  "*.*.passwordHash",
  "*.*.token",
  "*.*.accessToken",
  "*.*.refreshToken",
  "*.*.apiKey",
  "*.*.secret",
  "*.*.clientSecret",
  "*.*.privateKey",
  "*.*.otp",
  "*.*.mfaCode",
  "*.*.totpCode",
  "*.*.recoveryCode",
  "*.*.cardNumber",
  "*.*.cvv",
  "*.*.cardCvv",
  "*.*.aadhaar",
  "*.*.pan",
  "*.*.passport",
];

// Pretty logs ONLY in an interactive terminal (local laptop). On AWS/Docker/CI
// stdout is piped (not a TTY) → raw JSON for CloudWatch/Datadog. This is
// NODE_ENV-independent, so even a deployed "development" env logs raw JSON.
const usePretty = process.stdout.isTTY === true;

const options: LoggerOptions = {
  level: process.env.LOG_LEVEL ?? "info",
  // Std serializers cap what gets emitted from req/res/err — the first line
  // of defense before redact paths run.
  serializers: {
    req: pino.stdSerializers.req,
    res: pino.stdSerializers.res,
    err: pino.stdSerializers.err,
  },
  redact: {
    paths: redactPaths,
    censor: "[REDACTED]",
  },
  transport: usePretty
    ? {
        target: "pino-pretty",
        options: { colorize: true, translateTime: "HH:MM:ss.l" },
      }
    : undefined,
};

const logger = pino(options);

export default logger;
