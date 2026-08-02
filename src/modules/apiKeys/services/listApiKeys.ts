import { findAllApiKeys } from "../infra/apiKeyQueries.js";

export async function listApiKeys() {
  return findAllApiKeys();
}
