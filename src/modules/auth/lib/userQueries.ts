import { eq, inArray } from "drizzle-orm";
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

/**
 * Batch-fetch users by id for the per-request DataLoader.
 *
 * DataLoader contract: the returned array MUST be the same length as `ids`
 * and in the SAME ORDER — one slot per requested id (null if not found).
 * We fetch in a single `IN (...)` query, then re-map to preserve order.
 *
 * DataLoader may call this MORE THAN ONCE per request (loads scheduled in a
 * later event-loop tick, or `maxBatchSize` splitting a large key set). That's
 * fine — this function is correct for any subset of ids: order-preserving,
 * null-filling, and a no-op on an empty batch.
 */
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

export async function createUser({
  email,
  passwordHash,
  status, // optional — omit → DB default "active"; registerUser passes "pending"
}: NewUser): Promise<Pick<User, "id" | "email" | "status" | "createdAt">> {
  const [user] = await getDb()
    .insert(users)
    .values({ email: email.toLowerCase(), passwordHash, status })
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

// Flip a user's status (e.g. pending → active after email verification).
export async function updateUserStatus(
  userId: string,
  status: User["status"],
): Promise<void> {
  await getDb().update(users).set({ status }).where(eq(users.id, userId));
}

// Replace a user's password hash (reset + change-password flows). Caller hashes
// the plaintext — this layer only ever sees the bcrypt hash.
export async function updateUserPassword(
  userId: string,
  passwordHash: string,
): Promise<void> {
  await getDb().update(users).set({ passwordHash }).where(eq(users.id, userId));
}
