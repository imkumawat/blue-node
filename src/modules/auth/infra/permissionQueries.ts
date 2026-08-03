import { eq, inArray } from "drizzle-orm";
import { getDb } from "../../../lib/db/postgres/client.js";
import { getRedis } from "../../../lib/cache/redis/client.js";
import { userPermissions } from "../../../models/postgres/permission/userPermission.js";
import { permissions } from "../../../models/postgres/permission/permission.js";
import logger from "../../../utils/logger.js";
import { getEnvConfig } from "../../../config/env.js";

export async function getScopes(userId: string): Promise<string[]> {
  const { permTtl } = getEnvConfig().redis;
  const { permPrefix } = getEnvConfig().redis.keys;
  const cacheKey = `${permPrefix}${userId}`;

  const cached = await getRedis().get(cacheKey);
  if (cached) return JSON.parse(cached) as string[];

  const rows = await getDb()
    .select({ scope: permissions.scope })
    .from(userPermissions)
    .innerJoin(permissions, eq(userPermissions.permissionId, permissions.id))
    .where(eq(userPermissions.userId, userId));

  const scopes = rows.map((r) => r.scope);
  await getRedis().set(cacheKey, JSON.stringify(scopes), "EX", permTtl);
  return scopes;
}

export async function bustPermissionCache(userId: string): Promise<void> {
  const { permPrefix } = getEnvConfig().redis.keys;
  await getRedis().del(`${permPrefix}${userId}`);
}

export async function grantScopes(
  userId: string,
  scopeNames: string[],
): Promise<void> {
  if (!scopeNames.length) return;

  const perms = await getDb()
    .select({ id: permissions.id, scope: permissions.scope })
    .from(permissions)
    .where(inArray(permissions.scope, scopeNames));

  if (perms.length < scopeNames.length) {
    const found = perms.map((p) => p.scope);
    const missing = scopeNames.filter((s) => !found.includes(s));
    logger.warn({ userId, missing }, "grantScopes: unknown scope names");
  }

  if (!perms.length) return;

  await getDb()
    .insert(userPermissions)
    .values(perms.map((p) => ({ userId, permissionId: p.id })))
    .onConflictDoNothing();

  await bustPermissionCache(userId);
}
