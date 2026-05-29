export const SCOPES = {
  // Profile
  READ_PROFILE: "read_profile",
  WRITE_PROFILE: "write_profile",
  DELETE_ACCOUNT: "delete_account",

  // Users (admin assigned)
  READ_USERS: "read_users",
  WRITE_USERS: "write_users",
  DELETE_USERS: "delete_users",

  // Admin
  ADMIN_ACCESS: "admin_access",
} as const;

export type Scope = (typeof SCOPES)[keyof typeof SCOPES];

export const DEFAULT_USER_SCOPES: Scope[] = [
  SCOPES.READ_PROFILE,
  SCOPES.WRITE_PROFILE,
  SCOPES.DELETE_ACCOUNT,
];

export const DEFAULT_ADMIN_SCOPES: Scope[] = [
  SCOPES.READ_PROFILE,
  SCOPES.WRITE_PROFILE,
  SCOPES.DELETE_ACCOUNT,
  SCOPES.READ_USERS,
  SCOPES.WRITE_USERS,
  SCOPES.DELETE_USERS,
  SCOPES.ADMIN_ACCESS,
];
