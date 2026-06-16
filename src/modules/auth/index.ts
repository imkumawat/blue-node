// Public contract of the auth module. External code imports from here — never
// from services/ or lib/ directly — so the module's internal file layout can
// change without breaking consumers. Keep this curated (no `export *`): only
// the symbols other modules genuinely need.
export { verifyToken } from "./services/verifyToken.js";
export type { AuthUser } from "./services/verifyToken.js";
export { InvalidTokenError } from "./errors.js";
