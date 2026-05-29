import { findUserById } from "../lib/userQueries.js";
import { UserNotFoundError } from "../errors.js";
import type { User } from "../../../models/postgres/user/user.js";

export async function getUserById(userId: string): Promise<User> {
  const user = await findUserById(userId);
  if (!user) throw new UserNotFoundError();
  return user;
}
