/**
 * S26 Phase 8 — durable agent-execution recorder (PostgreSQL) tests.
 *
 * Verifies the PgAgentExecutionRecorder behind the EXISTING
 * `@nexora/module-agents` AgentExecutionRecorder port: journal round-trip,
 * tenant + user scoping (one user's runs never leak into another's agent
 * view), and newest-first ordering. Runs against a DEDICATED
 * `nexora_api_test` database (never the live dev database) and skips
 * cleanly when Postgres is unreachable, so `pnpm test` stays green without
 * infra.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Pool } from 'pg';
import { createDatabaseFromPool, runMigrations, type NexoraDatabase } from '@nexora/persistence';
import { PgAgentExecutionRecorder } from '../src/agent/pg-agent-execution-recorder.js';
import type { AgentExecutionRecord } from '@nexora/contracts/agent';

/** A dedicated test database — the live `nexora` dev database is never touched. */
const TEST_URL =
  process.env.TEST_DATABASE_URL ??
  process.env.API_TEST_DATABASE_URL ??
  'postgres://nexora:nexora_dev_password@localhost:5433/nexora_api_test';

/** The maintenance URL (same server, `postgres` db) for create/drop DDL. */
function maintenanceUrl(connectionString: string): string {
  const url = new URL(connectionString);
  url.pathname = '/postgres';
  return url.toString();
}

function databaseName(connectionString: string): string {
  return new URL(connectionString).pathname.replace(/^\//, '').split('?')[0] ?? '';
}

async function isDatabaseReachable(): Promise<boolean> {
  const pool = new Pool({
    connectionString: maintenanceUrl(TEST_URL),
    connectionTimeoutMillis: 1500,
  });
  try {
    await pool.query('SELECT 1');
    return true;
  } catch {
    return false;
  } finally {
    await pool.end();
  }
}

const describeDb = (await isDatabaseReachable()) ? describe : describe.skip;

const TENANT = 'org_agent_runs';
const USER_A = 'usr_alice';
const USER_B = 'usr_bob';

function recordFor(userId: string, createdAt: string): AgentExecutionRecord {
  return {
    id: `agx_${userId}_${createdAt}`,
    agentId: 'executive',
    roleId: 'executive.ceo',
    domainId: 'executive',
    tenantId: TENANT,
    userId,
    proposalId: 'propose_review_attention',
    proposalAction: 'Review what needs attention',
    status: 'completed',
    runId: `run_${createdAt}`,
    createdAt,
  };
}

describeDb('PgAgentExecutionRecorder (durable agent journal)', () => {
  let db: NexoraDatabase;
  let pool: Pool;

  beforeAll(async () => {
    const maintenance = new Pool({ connectionString: maintenanceUrl(TEST_URL) });
    try {
      const name = databaseName(TEST_URL);
      const existing = await maintenance.query('SELECT 1 FROM pg_database WHERE datname = $1', [
        name,
      ]);
      if ((existing.rowCount ?? 0) === 0) {
        await maintenance.query(`CREATE DATABASE "${name}"`);
      }
    } finally {
      await maintenance.end();
    }
    await runMigrations(TEST_URL);
    pool = new Pool({ connectionString: TEST_URL });
    db = createDatabaseFromPool(pool);
  });

  afterAll(async () => {
    await pool.end();
    const maintenance = new Pool({ connectionString: maintenanceUrl(TEST_URL) });
    try {
      await maintenance.query(`DROP DATABASE IF EXISTS "${databaseName(TEST_URL)}" WITH (FORCE)`);
    } finally {
      await maintenance.end();
    }
  });

  it('round-trips a journal entry', async () => {
    const recorder = new PgAgentExecutionRecorder(db);
    await recorder.record(recordFor(USER_A, '2026-08-15T10:00:00.000Z'));

    const runs = await recorder.listRecent({ tenantId: TENANT, userId: USER_A }, 10);
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({
      id: 'agx_usr_alice_2026-08-15T10:00:00.000Z',
      agentId: 'executive',
      roleId: 'executive.ceo',
      domainId: 'executive',
      tenantId: TENANT,
      userId: USER_A,
      proposalId: 'propose_review_attention',
      status: 'completed',
      runId: 'run_2026-08-15T10:00:00.000Z',
    });
  });

  it('lists newest-first and applies the limit', async () => {
    const recorder = new PgAgentExecutionRecorder(db);
    await recorder.record(recordFor(USER_A, '2026-08-15T09:00:00.000Z'));
    await recorder.record(recordFor(USER_A, '2026-08-15T11:00:00.000Z'));

    const runs = await recorder.listRecent({ tenantId: TENANT, userId: USER_A }, 10);
    expect(runs.map((r) => r.createdAt)).toEqual([
      '2026-08-15T11:00:00.000Z',
      '2026-08-15T10:00:00.000Z',
      '2026-08-15T09:00:00.000Z',
    ]);

    const limited = await recorder.listRecent({ tenantId: TENANT, userId: USER_A }, 2);
    expect(limited).toHaveLength(2);
    expect(limited[0]?.createdAt).toBe('2026-08-15T11:00:00.000Z');
  });

  it('never leaks one user runs into another user agent view', async () => {
    const recorder = new PgAgentExecutionRecorder(db);
    await recorder.record(recordFor(USER_B, '2026-08-15T12:00:00.000Z'));

    const aliceRuns = await recorder.listRecent({ tenantId: TENANT, userId: USER_A }, 10);
    expect(aliceRuns.every((r) => r.userId === USER_A)).toBe(true);
    expect(aliceRuns.some((r) => r.userId === USER_B)).toBe(false);
  });
});
