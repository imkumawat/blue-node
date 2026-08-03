// Public contract of the auth module. External code imports from here — never
// from services/ or infra/ directly — so the module's internal layout can change
// without breaking consumers. Keep this curated (no `export *`).

// Resolving an opaque first-party access token to its session. The one verifier
// every first-party transport shares: REST middleware, GraphQL context, the WS
// upgrade and the OAuth login form all go through this, so there is exactly one
// definition of what "signed in" means.
export { verifySessionToken } from "./services/verifySessionToken.js";

// Needed by the OAuth authorization endpoint, which serves a browser login form
// and so must go through the same lockout, CAPTCHA and account-status gating any
// other login does — reimplementing that for a second surface is how the two
// drift apart.
export { loginWithPassword } from "./services/loginWithPassword.js";

// The consent screen names the account being granted access, which needs more
// than the id a token carries.
export { getUserById } from "./services/getUserById.js";

export { InvalidTokenError, InvalidAuthSessionError } from "./errors.js";

export type { AuthSession } from "./types.js";
