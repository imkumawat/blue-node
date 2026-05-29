import { eq } from "drizzle-orm";
import { getDb } from "../../../lib/db/postgres/client.js";
import { users } from "../../../models/postgres/user/user.js";
import type { User, NewUser } from "../../../models/postgres/user/user.js";

export async function findUserByEmail(email: string): Promise<User | null> {
  const [user] = await getDb()
    .select()
    .from(users)
    .where(eq(users.email, email.toLowerCase()))
    .limit(1);
  return user ?? null;
}

export async function findUserById(id: string): Promise<User | null> {
  const [user] = await getDb()
    .select()
    .from(users)
    .where(eq(users.id, id))
    .limit(1);
  return user ?? null;
}

export async function createUser({
  email,
  passwordHash,
}: NewUser): Promise<Pick<User, "id" | "email" | "status" | "createdAt">> {
  const [user] = await getDb()
    .insert(users)
    .values({ email: email.toLowerCase(), passwordHash })
    .returning({
      id: users.id,
      email: users.email,
      status: users.status,
      createdAt: users.createdAt,
    });
  if (!user) {
    throw new Error("createUser: insert returned no rows");
  }
  return user;
}
