import { revokeApiKeyById, insertApiKey } from "../lib/apiKeyQueries.js";

export async function rotateApiKey({
  id,
  clientName,
  expiresAt = null,
}: {
  id: string;
  clientName: string;
  expiresAt?: Date | null;
}): Promise<{ key: string; keyPrefix: string; clientName: string }> {
  await revokeApiKeyById(id);
  return insertApiKey(clientName, expiresAt);
}
