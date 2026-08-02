import { and, desc, eq, gt, lt, isNull } from "drizzle-orm";
import { getDb } from "../../../lib/db/postgres/client.js";
import { sessions } from "../../../models/postgres/user/session.js";
import type { Session } from "../../../models/postgres/user/session.js";

/**
 * Device sessions. The only place that touches the sessions table.
 *
 * Everything here is a single statement on purpose. Where a check and a write
 * belong together they are ONE conditional statement rather than a read followed
 * by a write — see touchSession for why that matters.
 */

export interface InsertSessionInput {
  userId: string;
  tokenHash: string;
  deviceLabel: string | null;
  userAgent: string | null;
  ipAddress: string | null;
  expiresAt: Date;
}

export async function insertSession(
  input: InsertSessionInput,
): Promise<Session> {
  const [row] = await getDb().insert(sessions).values(input).returning();
  if (!row) throw new Error("insertSession: insert returned no rows");
  return row;
}

export async function findSession(id: string): Promise<Session | null> {
  const [row] = await getDb()
    .select()
    .from(sessions)
    .where(eq(sessions.id, id))
    .limit(1);
  return row ?? null;
}

export async function listSessions(userId: string): Promise<Session[]> {
  return getDb()
    .select()
    .from(sessions)
    .where(and(eq(sessions.userId, userId), gt(sessions.expiresAt, new Date())))
    .orderBy(desc(sessions.lastUsedAt));
}

export async function listSessionIds(userId: string): Promise<string[]> {
  const rows = await getDb()
    .select({ id: sessions.id })
    .from(sessions)
    .where(eq(sessions.userId, userId));

  return rows.map((row) => row.id);
}

export async function touchSession(
  id: string,
  tokenHash: string,
  expiresAt: Date,
): Promise<Session | null> {
  const [row] = await getDb()
    .update(sessions)
    .set({ tokenHash, rotatedAt: null, lastUsedAt: new Date(), expiresAt })
    .where(and(eq(sessions.id, id), gt(sessions.expiresAt, new Date())))
    .returning();

  return row ?? null;
}

export async function rotateSession(hash: string): Promise<Session | null> {
  const [rotated] = await getDb()
    .update(sessions)
    .set({ rotatedAt: new Date() })
    .where(
      and(
        eq(sessions.tokenHash, hash),
        isNull(sessions.rotatedAt),
        gt(sessions.expiresAt, new Date()),
      ),
    )
    .returning();
  return rotated ?? null;
}

export async function deleteSession(
  id: string,
  userId: string,
): Promise<boolean> {
  const deleted = await getDb()
    .delete(sessions)
    .where(and(eq(sessions.id, id), eq(sessions.userId, userId)))
    .returning({ id: sessions.id });

  return deleted.length > 0;
}

export async function deleteAllSessions(userId: string): Promise<string[]> {
  const deleted = await getDb()
    .delete(sessions)
    .where(eq(sessions.userId, userId))
    .returning({ id: sessions.id });

  return deleted.map((row) => row.id);
}

export async function pruneExpiredSessions(): Promise<number> {
  const deleted = await getDb()
    .delete(sessions)
    .where(lt(sessions.expiresAt, new Date()))
    .returning({ id: sessions.id });

  return deleted.length;
}
