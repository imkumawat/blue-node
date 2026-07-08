import DataLoader from "dataloader";
import { findUsersByIds } from "../../modules/auth/lib/userQueries.js";
import type { User } from "../../models/postgres/user/user.js";

/**
 * Per-request DataLoader set. Instantiated once per request in buildContext,
 * so the batching window AND the cache are scoped to a single request.
 *
 * NEVER instantiate at module level — that would batch/cache across requests
 * and leak one user's data into another's response.
 *
 * Add a loader per hot read path, e.g.:
 *   postsByUserId: new DataLoader<string, Post[]>(...)
 */
export interface Loaders {
  userById: DataLoader<string, User | null>;
}

export function createLoaders(): Loaders {
  return {
    // All `.load(id)` calls in one tick collapse into a single findUsersByIds().
    userById: new DataLoader<string, User | null>((ids) => findUsersByIds(ids)),
  };
}
