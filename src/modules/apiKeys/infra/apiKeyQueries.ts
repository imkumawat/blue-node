import crypto from "node:crypto";
import { eq } from "drizzle-orm";
import { getEnvConfig } from "../../../config/env.js";
import { getDb } from "../../../lib/db/postgres/client.js";
import { apiKeys } from "../../../models/postgres/auth/apiKey.js";
import type { ApiKey } from "../../../models/postgres/auth/apiKey.js";

function buildRawKey(): string {
  const { env, auth } = getEnvConfig();
  const tier = env === "production" ? "live" : "test";
  const random = crypto.randomBytes(32).toString("hex");
  return `${auth.apiKeyPrefix}${tier}_${random}`;
}

function hashKey(rawKey: string): string {
  return crypto.createHash("sha256").update(rawKey).digest("hex");
}

export async function insertApiKey(
  clientName: string,
  expiresAt: Date | null = null,
): Promise<{ key: string; keyPrefix: string; clientName: string }> {
  const rawKey = buildRawKey();
  const keyHash = hashKey(rawKey);
  const keyPrefix = rawKey.slice(0, 12);

  await getDb()
    .insert(apiKeys)
    .values({
      keyHash,
      keyPrefix,
      clientName,
      ...(expiresAt && { expiresAt }),
    });

  // rawKey returned ONCE — caller must send to client, never stored again
  return { key: rawKey, keyPrefix, clientName };
}

export async function revokeApiKeyById(id: string): Promise<void> {
  await getDb()
    .update(apiKeys)
    .set({ status: "revoked" })
    .where(eq(apiKeys.id, id));
}

export async function findApiKeyByHash(
  keyHash: string,
): Promise<ApiKey | null> {
  const [key] = await getDb()
    .select()
    .from(apiKeys)
    .where(eq(apiKeys.keyHash, keyHash))
    .limit(1);
  return key ?? null;
}

export async function touchApiKeyLastUsed(id: string): Promise<void> {
  await getDb()
    .update(apiKeys)
    .set({ lastUsedAt: new Date() })
    .where(eq(apiKeys.id, id));
}

export async function findAllApiKeys() {
  return getDb()
    .select({
      id: apiKeys.id,
      keyPrefix: apiKeys.keyPrefix,
      clientName: apiKeys.clientName,
      status: apiKeys.status,
      expiresAt: apiKeys.expiresAt,
      lastUsedAt: apiKeys.lastUsedAt,
      createdAt: apiKeys.createdAt,
    })
    .from(apiKeys);
}
