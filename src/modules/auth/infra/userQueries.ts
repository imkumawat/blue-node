import { eq, inArray } from "drizzle-orm";
import { getDb } from "../../../lib/db/postgres/client.js";
import { users } from "../../../models/postgres/user/user.js";
import type { User, NewUser } from "../../../models/postgres/user/user.js";

export async function createUser({
  email,
  passwordHash,
  status, // optional — omit → DB default "active"; registerUser passes "pending"
  firstName,
  lastName,
}: NewUser): Promise<Pick<User, "id" | "email" | "status" | "createdAt">> {
  const [user] = await getDb()
    .insert(users)
    .values({
      email: email.toLowerCase(),
      passwordHash,
      status,
      firstName,
      lastName,
    })
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

export async function findUsersByIds(
  ids: readonly string[],
): Promise<(User | null)[]> {
  if (ids.length === 0) return [];

  const rows = await getDb()
    .select()
    .from(users)
    .where(inArray(users.id, [...ids]));

  const byId = new Map(rows.map((u) => [u.id, u]));
  return ids.map((id) => byId.get(id) ?? null);
}

export async function updateUser(
  userId: string,
  data: Partial<User>,
): Promise<void> {
  await getDb().update(users).set(data).where(eq(users.id, userId));
}

export async function deleteUser(userId: string): Promise<void> {
  await getDb().delete(users).where(eq(users.id, userId));
}
