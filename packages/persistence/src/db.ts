/**
 * @nexora/persistence — Drizzle client factory.
 *
 * A thin factory over `drizzle-orm/node-postgres`. The database client is
 * wired by the application container (apps/api); repositories receive the
 * `NodePgDatabase` instance through their constructor.
 */

import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import pg from 'pg';

import * as schema from './schema/index.js';

export type NexoraDatabase = NodePgDatabase<typeof schema>;

/** The full schema reference for type-level access. */
export { schema };

/**
 * Creates a Drizzle client for the given connection string.
 *
 * @param connectionString - PostgreSQL connection string (`postgres://…`).
 * @returns a `NexoraDatabase` bound to the full schema.
 */
export function createDatabase(connectionString: string): NexoraDatabase {
  const pool = new pg.Pool({ connectionString });
  return drizzle(pool, { schema });
}

/**
 * Creates a Drizzle client over an existing `pg.Pool` (useful for tests and
 * connection lifecycle control).
 */
export function createDatabaseFromPool(pool: pg.Pool): NexoraDatabase {
  return drizzle(pool, { schema });
}
