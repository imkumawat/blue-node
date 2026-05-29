import { revokeApiKeyById } from "../lib/apiKeyQueries.js";

export async function revokeApiKey({ id }: { id: string }): Promise<void> {
  await revokeApiKeyById(id);
}
