import { findUserById } from "../lib/userQueries.js";
import { UserNotFoundError } from "../errors.js";
import type { User } from "../../../models/postgres/user/user.js";

export async function getUserById(userId: string): Promise<User> {
  const user = await findUserById(userId);
  if (!user) throw new UserNotFoundError();
  // removing password hash from the user object before returning it
  delete (user as Partial<User>).passwordHash;
  return user;
}
