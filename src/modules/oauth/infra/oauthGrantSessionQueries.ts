import { and, eq, gt, lt, or, sql } from "drizzle-orm";
import { getDb } from "../../../lib/db/postgres/client.js";
import { oauthGrantSessions } from "../../../models/postgres/oauth/oauthGrantSession.js";
import type { OauthGrantSession } from "../../../models/postgres/oauth/oauthGrantSession.js";

/**
 * Connections held under an OAuth grant. The only place that touches
 * oauth_grant_sessions.
 *
 * Reads here never take the presented secret on trust — the caller hashes it
 * first and this layer only ever compares digests.
 */

export interface InsertGrantSessionInput {
  // Supplied rather than defaulted: the refresh token embeds this id, so it has
  // to exist before the token can be minted, and both must carry the same value.
  id: string;
  grantId: string;
  tokenHash: string;
  expiresAt: Date;
  absoluteExpiresAt: Date;
  // The access token handed over alongside the first refresh token. Recorded so
  // the next rotation knows which token it is retiring.
  accessTokenJti: string;
  accessTokenExp: Date;
}

export async function insertGrantSession(
  input: InsertGrantSessionInput,
): Promise<OauthGrantSession> {
  const [row] = await getDb()
    .insert(oauthGrantSessions)
    .values(input)
    .returning();

  if (!row) throw new Error("insertGrantSession: insert returned no rows");
  return row;
}

/**
 * Reads one connection by id.
 *
 * Called after a rotation misses, to answer what the miss cannot: was the
 * presented secret one we issued and already retired, or just a string? The
 * caller compares against previousTokenHash — this layer does not decide.
 */
export async function findGrantSessionById(
  id: string,
): Promise<OauthGrantSession | null> {
  const [row] = await getDb()
    .select()
    .from(oauthGrantSessions)
    .where(eq(oauthGrantSessions.id, id))
    .limit(1);

  return row ?? null;
}

export interface RotateGrantSessionInput {
  id: string;
  /** HMAC of the refresh token being spent. */
  presentedHash: string;
  /** HMAC of its replacement. */
  nextTokenHash: string;
  slidingExpiresAt: Date;
  /** The access token minted alongside the replacement. */
  accessTokenJti: string;
  accessTokenExp: Date;
}

/**
 * Spends a refresh token and installs the replacement PAIR, in ONE statement.
 *
 * The row lock serialises concurrent presenters of the same token: the first
 * wins, the rest match nothing because the hash has already moved on. Doing this
 * as a read-then-write would open a window where both callers see a live token.
 *
 * The old hash is demoted rather than dropped, which is what makes a later
 * presentation of the spent token recognisable instead of merely absent.
 *
 * Both credentials are written together on purpose. Split across two statements,
 * a failure between them would leave the row pointing at an access token the
 * client no longer holds — and the next rotation would then deny the wrong one.
 *
 * The sliding expiry is clamped to the absolute one HERE rather than in the
 * caller: it is an invariant of the row (expires_at must never exceed
 * absolute_expires_at) and only the statement that writes it can enforce that
 * without a race.
 *
 * Returns the row as it is AFTER the update — Postgres RETURNING gives new
 * values, and there is no portable way to ask for the old ones. The retiring
 * access token's jti therefore has to come from a read taken BEFORE this call.
 * That read is safe to do non-atomically: it is only used for data, never as a
 * check, because the WHERE clause below is what actually guards the rotation.
 *
 * Null for every failure — unknown id, wrong secret, idle expiry passed, absolute
 * ceiling reached, or a token already spent. Comparing the presented hash against
 * the pre-read row's previousTokenHash tells the last one apart.
 */
export async function rotateGrantSession(
  input: RotateGrantSessionInput,
): Promise<OauthGrantSession | null> {
  const now = new Date();

  const [rotated] = await getDb()
    .update(oauthGrantSessions)
    .set({
      tokenHash: input.nextTokenHash,
      // The column's own pre-update value: inside one UPDATE this still reads the
      // row as it was, which is exactly the hash being spent.
      previousTokenHash: sql`${oauthGrantSessions.tokenHash}`,
      accessTokenJti: input.accessTokenJti,
      accessTokenExp: input.accessTokenExp,
      lastUsedAt: now,
      expiresAt: sql`LEAST(${input.slidingExpiresAt}, ${oauthGrantSessions.absoluteExpiresAt})`,
    })
    .where(
      and(
        eq(oauthGrantSessions.id, input.id),
        eq(oauthGrantSessions.tokenHash, input.presentedHash),
        gt(oauthGrantSessions.expiresAt, now),
        gt(oauthGrantSessions.absoluteExpiresAt, now),
      ),
    )
    .returning();

  return rotated ?? null;
}

/**
 * Ends every connection under a grant.
 *
 * Deleting the grant itself cascades here anyway; this exists for the case where
 * the grant stays and only its live credentials are cut — a reuse response, or a
 * step-up that wants the app to authorize again without losing the consent.
 */
export async function deleteGrantSessionsByGrant(
  grantId: string,
): Promise<number> {
  const deleted = await getDb()
    .delete(oauthGrantSessions)
    .where(eq(oauthGrantSessions.grantId, grantId))
    .returning({ id: oauthGrantSessions.id });

  return deleted.length;
}

/** Either clock can retire a connection, so the sweep checks both. */
export async function pruneExpiredGrantSessions(): Promise<number> {
  const now = new Date();

  const deleted = await getDb()
    .delete(oauthGrantSessions)
    .where(
      or(
        lt(oauthGrantSessions.expiresAt, now),
        lt(oauthGrantSessions.absoluteExpiresAt, now),
      ),
    )
    .returning({ id: oauthGrantSessions.id });

  return deleted.length;
}
