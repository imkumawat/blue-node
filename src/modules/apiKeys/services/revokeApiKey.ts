import { revokeApiKeyById } from "../infra/apiKeyQueries.js";

export async function revokeApiKey({ id }: { id: string }): Promise<void> {
  await revokeApiKeyById(id);
}
