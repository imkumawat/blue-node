import { insertApiKey } from "../lib/apiKeyQueries.js";

export async function generateApiKey({
  clientName,
  expiresAt = null,
}: {
  clientName: string;
  expiresAt?: Date | null;
}): Promise<{ key: string; keyPrefix: string; clientName: string }> {
  return insertApiKey(clientName, expiresAt);
}
