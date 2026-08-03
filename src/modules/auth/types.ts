import type { User } from "../../models/postgres/user/user.js";

export type PublicUser = Pick<
  User,
  "id" | "email" | "firstName" | "lastName" | "status" | "createdAt"
>;
export interface AuthSession {
  userId: string;
  sessionId: string;
  scopes: string[];
  exp: number;
}
