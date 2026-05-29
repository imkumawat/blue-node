import { SCOPES } from "../shared/constants/scopes.js";
import { getDb } from "../lib/db/postgres/client.js";
import { permissions } from "../models/postgres/permission/permission.js";
import logger from "../utils/logger.js";

export async function checkScopes(): Promise<void> {
  const expected = Object.values(SCOPES);

  const rows = await getDb()
    .select({ scope: permissions.scope })
    .from(permissions);
  const seeded = rows.map((r) => r.scope);

  const missing = expected.filter((s) => !seeded.includes(s));

  if (missing.length) {
    logger.fatal({ missing }, "Scope mismatch -- run seed before starting");
    process.exit(1);
  }

  logger.info("Scopes verified");
}
