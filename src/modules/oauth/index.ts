// Public contract of the oauth module. External code imports from here — never
// from services/ or infra/ directly — so the module's internal layout can change
// without breaking consumers. Keep this curated (no `export *`).

// Verifying a grant's access token. Exported from infra/ deliberately: signing
// and verifying are pure computation over the loaded keys, not store access, so
// the boundary this barrel protects is not crossed by exposing them.
export { verifyGrantAccessToken } from "./infra/oauthTokens.js";
export type {
  GrantAccessClaims,
  VerifiedGrantAccessToken,
} from "./infra/oauthTokens.js";

// Whether a verified token has been retired early — by its pair rotating away or
// by the grant being disconnected. A signature alone cannot answer that, so any
// resource server validating our tokens has to ask.
export { isAccessTokenDenied } from "./infra/oauthTokenStore.js";
