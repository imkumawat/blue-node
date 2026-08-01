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

/**
 * Powers the "where you're logged in" screen. Most recently active first.
 *
 * Expired rows are excluded rather than left to the sweep: a session past its
 * expiry is already dead, and showing it would tell someone they are signed in
 * on a device where they are not.
 */
export async function listSessions(userId: string): Promise<Session[]> {
  return getDb()
    .select()
    .from(sessions)
    .where(and(eq(sessions.userId, userId), gt(sessions.expiresAt, new Date())))
    .orderBy(desc(sessions.lastUsedAt));
}

/**
 * Ids only — what revoke-all needs to build its Redis DEL.
 *
 * Expired rows are INCLUDED here, unlike listSessions: their access-token keys
 * may still be live in Redis, and deleting an already-absent key is free.
 */
export async function listSessionIds(userId: string): Promise<string[]> {
  const rows = await getDb()
    .select({ id: sessions.id })
    .from(sessions)
    .where(eq(sessions.userId, userId));

  return rows.map((row) => row.id);
}

/**
 * Slides the session forward and stamps activity — and doubles as the existence
 * check for the refresh path.
 *
 * Returns null when no live session matched, and callers MUST treat that as a
 * refusal to mint. The reason is a race that a read-then-write cannot close: a
 * refresh reads the session, the user signs that device out in another tab, and
 * the refresh then writes an access token into Redis under a session id that no
 * longer exists. Nothing on the read path consults this table, so that orphan
 * token would keep working until its TTL ran out.
 *
 * Making the UPDATE itself conditional on `expires_at > now()` collapses exists,
 * not-expired and slide into one atomic statement, so there is no window to lose.
 */
export async function touchSession(
  id: string,
  tokenHash: string,
  expiresAt: Date,
): Promise<Session | null> {
  const [row] = await getDb()
    .update(sessions)
    .set({ tokenHash, lastUsedAt: new Date(), expiresAt })
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

/**
 * Ends one session. Returns false when nothing matched, so a caller can answer
 * 404 rather than a misleading success.
 *
 * Scoped by user_id as well as id: a session id is not a capability — it travels
 * in plain sight inside every access token — so without this scope anyone
 * holding another user's id could end their session.
 */
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

/** Sign out everywhere. */
export async function deleteAllSessions(userId: string): Promise<void> {
  await getDb().delete(sessions).where(eq(sessions.userId, userId));
}

/**
 * The expiry sweep, for a scheduled job. Cheap because of
 * sessions_expires_at_idx; returns the count so the job has something to log.
 */
export async function pruneExpiredSessions(): Promise<number> {
  const deleted = await getDb()
    .delete(sessions)
    .where(lt(sessions.expiresAt, new Date()))
    .returning({ id: sessions.id });

  return deleted.length;
}
