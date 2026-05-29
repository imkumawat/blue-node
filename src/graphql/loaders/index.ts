/**
 * Per-request DataLoader factory. Called once per request from buildContext.
 *
 * DataLoaders batch + cache resolver-level reads within a single request to
 * eliminate N+1 queries (e.g. `users { posts { author { name } } }`).
 *
 * Pattern when adding a loader:
 *
 *   import DataLoader from "dataloader";
 *   import { findUsersByIds } from "../../modules/auth/lib/userQueries.js";
 *
 *   export function createLoaders(): Loaders {
 *     return {
 *       userById: new DataLoader(async (ids) => {
 *         const users = await findUsersByIds(ids);
 *         return ids.map(id => users.find(u => u.id === id) ?? null);
 *       }),
 *     };
 *   }
 *
 * Resolver usage:
 *   User: {
 *     posts: (parent, _, ctx) => ctx.loaders.postsByUserId.load(parent.id),
 *   }
 *
 * IMPORTANT: must be called per-request (in buildContext). NEVER instantiate
 * at module level — that would cache across requests and leak data between users.
 */
export type Loaders = Record<string, never>;

export function createLoaders(): Loaders {
  return {};
}
