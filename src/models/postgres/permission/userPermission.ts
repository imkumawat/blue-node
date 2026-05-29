import { pgTable, uuid, primaryKey, index } from "drizzle-orm/pg-core";
import { users } from "../user/user.js";
import { permissions } from "./permission.js";

export const userPermissions = pgTable(
  "user_permissions",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    permissionId: uuid("permission_id")
      .notNull()
      .references(() => permissions.id, { onDelete: "cascade" }),
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.permissionId] }),
    index("user_permissions_user_id_idx").on(table.userId),
  ],
);

export type UserPermission = typeof userPermissions.$inferSelect;
export type NewUserPermission = typeof userPermissions.$inferInsert;

/*
  CREATE TABLE user_permissions (
    user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    permission_id UUID NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
    PRIMARY KEY (user_id, permission_id)
  );
  CREATE INDEX user_permissions_user_id_idx ON user_permissions(user_id);
*/
