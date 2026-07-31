/**
 * Scope catalog — every permission this platform can grant.
 *
 * Naming is `resource:action`. It groups by resource when sorted, reads the same
 * way on a consent screen as in a policy, and leaves room for a future wildcard
 * (`users:*`). Each string is a PUBLIC CONTRACT: it is stored in
 * `permissions.scope`, embedded in issued tokens, and shown to users on the
 * consent screen — renaming one invalidates existing rows, grants and tokens.
 *
 * Nothing is granted by default. Signup creates no permission rows; a scope is
 * held only through a staff preset or an explicit `user_permissions` row.
 * Self-service routes authorize on OWNERSHIP (`req.user.id === target`), not on
 * a scope — `profile:read` exists so a THIRD-PARTY client can be delegated that
 * access, not to let someone read their own profile.
 */
export const SCOPES = {
  // Own account. Held only when delegated to a client, never granted at signup.
  PROFILE_READ: "profile:read",
  PROFILE_WRITE: "profile:write",
  ACCOUNT_DELETE: "account:delete",

  // Other people's accounts — staff capability.
  USERS_READ: "users:read",
  USERS_WRITE: "users:write",
  USERS_DELETE: "users:delete",

  // Granting and revoking permissions. Kept separate from `users:write` on
  // purpose: editing a user is not the same power as deciding what a user may do.
  PERMISSIONS_READ: "permissions:read",
  PERMISSIONS_WRITE: "permissions:write",

  // The admin surface itself.
  ADMIN_ACCESS: "admin:access",
} as const;

export type Scope = (typeof SCOPES)[keyof typeof SCOPES];

/*
  -- Catalog seed. `checkScopes()` hard-exits at boot if any scope above is
  -- missing from this table, so run it before starting the app.
  --
  -- `permissions.id` has no DB-side default (Drizzle fills it via generateId on
  -- app inserts), so raw SQL must supply one. These rows are a static catalog
  -- and `scope` is the natural key, so the id value itself is arbitrary.

  INSERT INTO permissions (id, scope, description) VALUES
    (gen_random_uuid(), 'profile:read',      'View your email address and account status'),
    (gen_random_uuid(), 'profile:write',     'Update your profile'),
    (gen_random_uuid(), 'account:delete',    'Delete your account'),
    (gen_random_uuid(), 'users:read',        'View other users'),
    (gen_random_uuid(), 'users:write',       'Create and modify other users'),
    (gen_random_uuid(), 'users:delete',      'Delete other users'),
    (gen_random_uuid(), 'permissions:read',  'View what permissions a user holds'),
    (gen_random_uuid(), 'permissions:write', 'Grant and revoke permissions'),
    (gen_random_uuid(), 'admin:access',      'Access the admin surface')
  ON CONFLICT (scope) DO NOTHING;

*/
