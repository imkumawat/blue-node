import { eq } from "drizzle-orm";
import { getDb } from "../../../lib/db/postgres/client.js";
import { oauthClients } from "../../../models/postgres/oauth/oauthClient.js";
import type {
  OauthClient,
  NewOauthClient,
} from "../../../models/postgres/oauth/oauthClient.js";

export async function insertClient(
  client: NewOauthClient,
): Promise<OauthClient> {
  const [row] = await getDb().insert(oauthClients).values(client).returning();
  if (!row) throw new Error("insertClient: insert returned no rows");
  return row;
}

export async function findClientById(id: string): Promise<OauthClient | null> {
  const [row] = await getDb()
    .select()
    .from(oauthClients)
    .where(eq(oauthClients.id, id))
    .limit(1);
  return row ?? null;
}

export async function touchClientLastUsed(id: string): Promise<void> {
  await getDb()
    .update(oauthClients)
    .set({ lastUsedAt: new Date() })
    .where(eq(oauthClients.id, id));
}
