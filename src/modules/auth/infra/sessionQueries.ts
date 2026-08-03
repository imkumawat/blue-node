import { and, desc, eq, gt, lt, sql } from "drizzle-orm";
import { getDb } from "../../../lib/db/postgres/client.js";
import { sessions } from "../../../models/postgres/user/session.js";
import type { Session } from "../../../models/postgres/user/session.js";

/**
 * Device sessions. The only place that touches the sessions table.
 *
 * Everything here is a single statement on purpose. Where a check and a write
 * belong together they are ONE conditional statement rather than a read followed
 * by a write — see rotateSession for why that matters.
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

/**
 * Spends a refresh token and installs its replacement, in ONE statement.
 *
 * Single statement is the whole design. Claiming the row and writing the new
 * hash used to be two, with a Redis round trip in between — so any hiccup there
 * left the row claimed but still holding the old hash, and the device could
 * never refresh again. The row lock here serialises concurrent presenters of the
 * same token: the first wins, the rest match nothing because the hash has
 * already moved on.
 *
 * The old hash is not discarded, it is demoted. That demotion is what makes a
 * later presentation of the spent token recognisable instead of merely absent.
 *
 * Returns null for every failure — wrong token, expired session, or a token
 * already spent. Only findSessionByPreviousTokenHash can tell the last one apart.
 */
export async function rotateSession(
  presentedHash: string,
  nextHash: string,
  expiresAt: Date,
): Promise<Session | null> {
  const [rotated] = await getDb()
    .update(sessions)
    .set({
      tokenHash: nextHash,
      // Read the column's own pre-update value: inside one UPDATE this still
      // sees the row as it was, which is precisely the hash being spent.
      previousTokenHash: sql`${sessions.tokenHash}`,
      lastUsedAt: new Date(),
      expiresAt,
    })
    .where(
      and(
        eq(sessions.tokenHash, presentedHash),
        gt(sessions.expiresAt, new Date()),
      ),
    )
    .returning();

  return rotated ?? null;
}

/**
 * Finds the session a spent refresh token used to belong to.
 *
 * Only called after rotateSession misses, to answer the one question that miss
 * cannot: was this a credential we issued and already retired, or just a string?
 * A hit means a token that was valid is being presented after it was spent.
 */
export async function findSessionByPreviousTokenHash(
  hash: string,
): Promise<Session | null> {
  const [row] = await getDb()
    .select()
    .from(sessions)
    .where(eq(sessions.previousTokenHash, hash))
    .limit(1);

  return row ?? null;
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
