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
