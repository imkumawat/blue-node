import { drizzle } from "drizzle-orm/node-postgres";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import pg from "pg";
import type { Pool as PoolType } from "pg";
import { getEnvConfig } from "../../../config/env.js";
import { serviceState } from "../../../utils/serviceState.js";
import logger from "../../../utils/logger.js";

const { Pool } = pg;

let pool: PoolType | undefined;
let _pgClient: NodePgDatabase | undefined;

export async function connectPostgres(): Promise<void> {
  const { host, port, name, user, password, pool: p } = getEnvConfig().postgres;

  pool = new Pool({
    host,
    port,
    database: name,
    user,
    password,
    max: p.max,
    min: p.min,
    idleTimeoutMillis: p.idleTimeoutMillis,
    connectionTimeoutMillis: p.connectionTimeoutMillis,
    statement_timeout: p.statementTimeoutMs,
    query_timeout: p.queryTimeoutMs,
    application_name: p.applicationName,
  });

  pool.on("error", (err: Error) => {
    serviceState.postgres = false;
    logger.error({ err: err.message }, "PostgreSQL pool error");
  });

  pool.on("connect", () => {
    serviceState.postgres = true;
  });

  try {
    const client = await pool.connect();
    client.release();
  } catch (err) {
    logger.fatal(
      { err: err instanceof Error ? err.message : String(err) },
      "Failed to connect to PostgreSQL",
    );
    process.exit(1);
  }

  serviceState.postgres = true;
  _pgClient = drizzle(pool);
  logger.info("PostgreSQL connected");
}

export async function disconnectPostgres(): Promise<void> {
  try {
    await pool?.end();
  } catch (err) {
    logger.warn(
      { err: err instanceof Error ? err.message : String(err) },
      "PostgreSQL pool.end() failed during shutdown",
    );
  }
  _pgClient = undefined;
  logger.info("PostgreSQL disconnected");
}

/**
 * Returns the Drizzle DB client. Throws if `connectPostgres()` hasn't run.
 * Use this instead of importing a module-level `pgClient` directly — safer
 * because runtime errors are explicit, and easier to mock in tests.
 */
export function getDb(): NodePgDatabase {
  if (!_pgClient) {
    throw new Error("Postgres not connected. Call connectPostgres() first.");
  }
  return _pgClient;
}
