// Public contract of the auth module. External code imports from here — never
// from services/ or lib/ directly — so the module's internal file layout can
// change without breaking consumers. Keep this curated (no `export *`): only
// the symbols other modules genuinely need.
export { verifyToken } from "./services/verifyToken.js";
export { verifySessionToken } from "./services/verifySessionToken.js";
export type { AuthUser } from "./services/verifyToken.js";
export { InvalidTokenError } from "./errors.js";
// Token minting for an OAuth grant. Deliberately narrow: modules/oauth needs
// credentials issued, not access to the refresh-token table or the rotation
// logic that guards it, both of which stay private to this module.
export { issueGrantTokens } from "./services/issueGrantTokens.js";
export type { GrantTokens } from "./services/issueGrantTokens.js";
// Needed by the OAuth authorization endpoint, which serves a browser login form
// and so must go through the same lockout, CAPTCHA and account-status gating any
// other login does — reimplementing that for a second surface is how the two
// drift apart.
export { loginWithPassword } from "./services/loginWithPassword.js";
// The consent screen names the account being granted access, which needs more
// than the id the token carries.
export { getUserById } from "./services/getUserById.js";
// Spends an OAuth refresh token (rotation + reuse detection) and reports whose
// grant it was. Paired with issueGrantTokens: this ends a session, that starts one.
export { consumeGrantRefreshToken } from "./services/consumeGrantRefreshToken.js";
