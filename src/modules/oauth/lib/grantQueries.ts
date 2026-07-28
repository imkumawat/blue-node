import { and, eq, sql } from "drizzle-orm";
import { getDb } from "../../../lib/db/postgres/client.js";
import { oauthGrants } from "../../../models/postgres/oauth/oauthGrant.js";
import type { OauthGrant } from "../../../models/postgres/oauth/oauthGrant.js";

export async function findGrant(
  userId: string,
  clientId: string,
): Promise<OauthGrant | null> {
  const [row] = await getDb()
    .select()
    .from(oauthGrants)
    .where(
      and(eq(oauthGrants.userId, userId), eq(oauthGrants.clientId, clientId)),
    )
    .limit(1);
  return row ?? null;
}

/** Refresh flows know the grant id from the token, not the user/client pair. */
export async function findGrantById(id: string): Promise<OauthGrant | null> {
  const [row] = await getDb()
    .select()
    .from(oauthGrants)
    .where(eq(oauthGrants.id, id))
    .limit(1);
  return row ?? null;
}

/**
 * Records consent, adding to whatever the user already granted this client.
 *
 * Scopes are UNIONED, never replaced: approving a newly requested scope must not
 * silently drop one approved earlier. The union runs in SQL rather than as a
 * read-modify-write so two consent submissions racing each other cannot lose one
 * of the additions — the unique (user_id, client_id) index makes the second one
 * an update against the first's result rather than a competing row.
 *
 * Sorted so stored scopes are deterministic and diffable.
 */
export async function upsertGrant(
  userId: string,
  clientId: string,
  scopes: string[],
): Promise<OauthGrant> {
  const [row] = await getDb()
    .insert(oauthGrants)
    .values({ userId, clientId, scopes })
    .onConflictDoUpdate({
      target: [oauthGrants.userId, oauthGrants.clientId],
      set: {
        scopes: sql`ARRAY(
          SELECT DISTINCT unnest(${oauthGrants.scopes} || excluded.scopes)
          ORDER BY 1
        )`,
      },
    })
    .returning();

  if (!row) throw new Error("upsertGrant: upsert returned no rows");
  return row;
}

// Powers the "last used" column on a connected-apps screen.
export async function touchGrantLastUsed(id: string): Promise<void> {
  await getDb()
    .update(oauthGrants)
    .set({ lastUsedAt: new Date() })
    .where(eq(oauthGrants.id, id));
}
