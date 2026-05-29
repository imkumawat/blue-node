import { findAllApiKeys } from "../lib/apiKeyQueries.js";

export async function listApiKeys() {
  return findAllApiKeys();
}
