/**
 * Test database isolation (product stabilization).
 *
 * The repository integration suite is DESTRUCTIVE by design — it truncates
 * every table it exercises in `afterAll`. It must therefore NEVER run
 * against the live development database (compose `nexora` at :5433). This
 * module resolves the target connection string, refuses the known live
 * database, and creates/drops a dedicated `nexora_test` database so that
 * `pnpm test` leaves local dev data intact (see the Day 1 stabilization
 * pass: the integration suite previously wiped the dev database).
 */

import { Pool } from 'pg';

/** The compose development database that destructive tests must never touch. */
export const LIVE_DATABASE_NAME = 'nexora';

/** Default target for integration tests: a dedicated test database. */
const DEFAULT_TEST_URL = 'postgres://nexora:nexora_dev_password@localhost:5433/nexora_test';

const SAFE_IDENTIFIER = /^[a-zA-Z0-9_]+$/;

/** Extracts the database name from a connection string, or `null`. */
export function databaseNameOf(connectionString: string): string | null {
  try {
    const pathname = new URL(connectionString).pathname;
    const name = pathname.replace(/^\//, '').split('?')[0] ?? '';
    return name.length > 0 ? name : null;
  } catch {
    return null;
  }
}

/**
 * Resolves the connection string the integration suite runs against.
 *
 * - `TEST_DATABASE_URL` wins when set (CI / dedicated test database).
 * - Otherwise `DATABASE_URL` is used.
 * - Otherwise the default `nexora_test` test database is used.
 *
 * Refuses the live `nexora` dev database with a loud error instead of
 * silently destroying local data.
 */
export function resolveTestDatabaseUrl(env: NodeJS.ProcessEnv = process.env): string {
  const candidate = env.TEST_DATABASE_URL ?? env.DATABASE_URL ?? DEFAULT_TEST_URL;
  if (databaseNameOf(candidate) === LIVE_DATABASE_NAME) {
    throw new Error(
      `Refusing to run destructive repository integration tests against the live ` +
        `development database '${LIVE_DATABASE_NAME}'. Set TEST_DATABASE_URL to a ` +
        `dedicated test database (e.g. postgres://nexora:nexora_dev_password@localhost:5433/nexora_test).`,
    );
  }
  return candidate;
}

/**
 * The maintenance connection string (same server, `postgres` database) used
 * to create and drop test databases — the test database itself may not exist
 * yet, and DDL against it cannot run from inside it.
 */
export function maintenanceUrlOf(connectionString: string): string {
  const url = new URL(connectionString);
  url.pathname = '/postgres';
  return url.toString();
}

function assertSafeName(name: string | null): string {
  if (name === null || name === 'postgres' || !SAFE_IDENTIFIER.test(name)) {
    throw new Error(`Unsafe test database name '${String(name)}'.`);
  }
  return name;
}

/** Creates the target test database when it does not yet exist. */
export async function ensureTestDatabase(connectionString: string): Promise<void> {
  const name = assertSafeName(databaseNameOf(connectionString));
  const pool = new Pool({ connectionString: maintenanceUrlOf(connectionString) });
  try {
    const existing = await pool.query('SELECT 1 FROM pg_database WHERE datname = $1', [name]);
    if ((existing.rowCount ?? 0) === 0) {
      await pool.query(`CREATE DATABASE "${name}"`);
    }
  } finally {
    await pool.end();
  }
}

/** Drops the target test database (force-disconnects lingering pools). */
export async function dropTestDatabase(connectionString: string): Promise<void> {
  const name = assertSafeName(databaseNameOf(connectionString));
  const pool = new Pool({ connectionString: maintenanceUrlOf(connectionString) });
  try {
    await pool.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
  } finally {
    await pool.end();
  }
}
