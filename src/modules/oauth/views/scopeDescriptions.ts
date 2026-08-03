import { SCOPES } from "../../../shared/constants/scopes.js";
import type { Scope } from "../../../shared/constants/scopes.js";

/**
 * What each scope means to a person.
 *
 * Separate from the catalog on purpose: `scopes.ts` holds the machine contract —
 * the strings that go into tokens, rows and grants — while this holds copy a user
 * reads before approving. Two different things that change for different reasons,
 * and only the consent screen needs this half.
 *
 * Typed `Record<Scope, string>`, so adding a scope to the catalog without writing
 * a description here is a COMPILE ERROR rather than a blank line on the consent
 * screen. That failure mode matters: an unlabelled permission is one a user
 * cannot meaningfully approve.
 *
 * Written in the second person and in terms of consequence, not mechanism — "View
 * your email address", not "read the users table". The reader is deciding whether
 * to hand an app access to their own account.
 */
export const SCOPE_DESCRIPTIONS: Record<Scope, string> = {
  [SCOPES.PROFILE_READ]: "View your email address and account status",
  [SCOPES.PROFILE_WRITE]: "Update your profile",
  [SCOPES.ACCOUNT_DELETE]: "Delete your account",
  [SCOPES.USERS_READ]: "View other users",
  [SCOPES.USERS_WRITE]: "Create and modify other users",
  [SCOPES.USERS_DELETE]: "Delete other users",
  [SCOPES.PERMISSIONS_READ]: "View what permissions a user holds",
  [SCOPES.PERMISSIONS_WRITE]: "Grant and revoke permissions",
  [SCOPES.ADMIN_ACCESS]: "Full administrative access",
};
