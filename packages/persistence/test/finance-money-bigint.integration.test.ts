/**
 * Money columns hold the whole domain range.
 *
 * The finance domain accepts up to 1e11 minor units, but the columns were
 * `integer` (int4, max 2 147 483 647): a valid budget or expense above ~21.4M
 * major units passed validation and then failed in the database (HTTP 500).
 * Migration 0027 widens both to `bigint`; drizzle reads them back as numbers.
 *
 * Throwaway database; skips cleanly when Postgres is unreachable.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Pool } from 'pg';
import { eq } from 'drizzle-orm';

import { createDatabaseFromPool } from '../src/db.js';
import { runMigrations } from '../src/migrate.js';
import { budgets, expenses } from '../src/schema/index.js';
import { maintenanceUrlOf, resolveTestDatabaseUrl } from './db-isolation.js';

const BASE_URL = resolveTestDatabaseUrl();
const DB_NAME = 'nexora_money_bigint_pg_test';
const dbUrl = ((): string => {
  const url = new URL(BASE_URL);
  url.pathname = `/${DB_NAME}`;
  return url.toString();
})();

async function admin<T>(work: (pool: Pool) => Promise<T>): Promise<T> {
  const pool = new Pool({
    connectionString: maintenanceUrlOf(BASE_URL),
    connectionTimeoutMillis: 3000,
  });
  try {
    return await work(pool);
  } finally {
    await pool.end();
  }
}
const reachable = await admin((p) => p.query('SELECT 1')).then(
  () => true,
  () => false,
);
const describeDb = reachable ? describe : describe.skip;

/** The largest value the finance domain accepts (`MAX_MINOR_UNITS`). */
const DOMAIN_MAX = 100_000_000_000;
const NOW = new Date('2026-09-01T00:00:00.000Z');

describeDb('finance money columns (real PostgreSQL)', () => {
  let pool: Pool;

  beforeAll(async () => {
    await admin(async (p) => {
      await p.query(`DROP DATABASE IF EXISTS "${DB_NAME}" WITH (FORCE)`);
      await p.query(`CREATE DATABASE "${DB_NAME}"`);
    });
    await runMigrations(dbUrl);
    pool = new Pool({ connectionString: dbUrl });
  });
  afterAll(async () => {
    await pool?.end();
    await admin((p) => p.query(`DROP DATABASE IF EXISTS "${DB_NAME}" WITH (FORCE)`));
  });

  it('both columns are bigint', async () => {
    const { rows } = await pool.query(
      `SELECT table_name, column_name, data_type FROM information_schema.columns
        WHERE (table_name, column_name) IN (('budgets','allocated_minor_units'),('expenses','amount_minor_units'))
        ORDER BY table_name`,
    );
    expect(rows.map((row) => row.data_type)).toEqual(['bigint', 'bigint']);
  });

  it('a budget and an expense at the domain maximum persist and read back as exact numbers', async () => {
    const db = createDatabaseFromPool(pool);
    await db.insert(budgets).values({
      id: 'bud_max',
      organizationId: 'org_a',
      workspaceId: 'wsp_a',
      createdBy: 'usr_a',
      name: 'Max budget',
      allocatedMinorUnits: DOMAIN_MAX,
      currency: 'INR',
      periodStart: NOW,
      periodEnd: NOW,
      status: 'active',
      createdAt: NOW,
      updatedAt: NOW,
    });
    await db.insert(expenses).values({
      id: 'exp_max',
      organizationId: 'org_a',
      workspaceId: 'wsp_a',
      budgetId: 'bud_max',
      submittedBy: 'usr_a',
      description: 'Max expense',
      amountMinorUnits: DOMAIN_MAX,
      currency: 'INR',
      status: 'pending',
      createdAt: NOW,
      updatedAt: NOW,
    });
    const [budget] = await db.select().from(budgets).where(eq(budgets.id, 'bud_max'));
    const [expense] = await db.select().from(expenses).where(eq(expenses.id, 'exp_max'));
    expect(budget?.allocatedMinorUnits).toBe(DOMAIN_MAX);
    expect(expense?.amountMinorUnits).toBe(DOMAIN_MAX);
    expect(typeof budget?.allocatedMinorUnits).toBe('number');
  });
});
