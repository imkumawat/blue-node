import { findApiKeyByHash, touchApiKeyLastUsed } from "../lib/apiKeyQueries.js";
import { sha256 } from "../../../shared/utils/crypto.js";
import { ApiKeyExpiredError } from "../errors.js";
import logger from "../../../utils/logger.js";

/**
 * Verifies a raw API key string and returns the api-client shape.
 * Returns null if key not found or revoked (caller throws specific error).
 * Throws ApiKeyExpiredError if key past expiry.
 */
export async function verifyApiKey(
  rawKey: string,
): Promise<{ id: string; clientName: string } | null> {
  const keyHash = sha256(rawKey);
  const apiKey = await findApiKeyByHash(keyHash);

  if (!apiKey || apiKey.status !== "active") return null;

  if (apiKey.expiresAt && apiKey.expiresAt < new Date()) {
    throw new ApiKeyExpiredError();
  }

  // fire-and-forget — housekeeping must not block the request, but failures
  // are logged (not silently swallowed) so DB issues stay visible.
  void touchApiKeyLastUsed(apiKey.id).catch((err: unknown) =>
    logger.warn({ err, apiKeyId: apiKey.id }, "touchApiKeyLastUsed failed"),
  );

  return { id: apiKey.id, clientName: apiKey.clientName };
}
