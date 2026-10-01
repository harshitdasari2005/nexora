/**
 * Approval `executing` recovery (lease reaper) — PostgreSQL.
 *
 * Runs against a THROWAWAY database (`nexora_approval_recovery_pg_test`),
 * created and dropped by the test. Skips cleanly when Postgres is unreachable.
 * Recovery is one conditional UPDATE (`status='executing' AND executed_at <=
 * now - lease`): executing → failed(RECOVERY_REQUIRED) only, never a re-run.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Pool } from 'pg';
import { createDatabaseFromPool, runMigrations, type NexoraDatabase } from '@nexora/persistence';
import {
  APPROVAL_RECOVERY_REQUIRED_ERROR,
  EXECUTING_LEASE_MS,
  isRecoveryRequired,
} from '@nexora/ai-runtime';
import { PgApprovalEngine } from '../src/ai/pg-approval-engine.js';

const BASE_URL =
  process.env.TEST_DATABASE_URL ??
  process.env.API_TEST_DATABASE_URL ??
  'postgres://nexora:nexora_dev_password@localhost:5433/nexora_api_test';
const DB_NAME = 'nexora_approval_recovery_pg_test';

function withDatabase(connectionString: string, name: string): string {
  const url = new URL(connectionString);
  url.pathname = `/${name}`;
  return url.toString();
}

const DB_URL = withDatabase(BASE_URL, DB_NAME);
const MAINTENANCE_URL = withDatabase(BASE_URL, 'postgres');

async function isDatabaseReachable(): Promise<boolean> {
  const pool = new Pool({ connectionString: MAINTENANCE_URL, connectionTimeoutMillis: 1500 });
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

const T0 = Date.parse('2026-09-01T09:00:00.000Z');
let seq = 0;

function openInput(tenantId = 'org_rec_a', overrides: Record<string, unknown> = {}) {
  seq += 1;
  return {
    conversationId: 'conv_rec',
    userId: 'usr_alice',
    tenantId,
    workspaceId: 'wsp_rec',
    runId: `run_rec_${seq}`,
    stepId: 'finance.submit_expense',
    toolId: 'finance.submit_expense',
    capabilityId: 'finance.submit_expense',
    sideEffectClass: 'consequential' as const,
    reason: 'Approval required',
    intent: 'Submit an expense',
    input: { amount: seq },
    ...overrides,
  };
}

describeDb('PgApprovalEngine.recoverStale', () => {
  let pool: Pool;
  let db: NexoraDatabase;
  let now = T0;
  let engine: PgApprovalEngine;

  beforeAll(async () => {
    const maintenance = new Pool({ connectionString: MAINTENANCE_URL });
    try {
      await maintenance.query(`DROP DATABASE IF EXISTS "${DB_NAME}" WITH (FORCE)`);
      await maintenance.query(`CREATE DATABASE "${DB_NAME}"`);
    } finally {
      await maintenance.end();
    }
    await runMigrations(DB_URL);
    pool = new Pool({ connectionString: DB_URL });
    db = createDatabaseFromPool(pool);
    engine = new PgApprovalEngine(db, { clock: { now: () => new Date(now) } });
  });

  afterAll(async () => {
    await pool?.end();
    const maintenance = new Pool({ connectionString: MAINTENANCE_URL });
    try {
      await maintenance.query(`DROP DATABASE IF EXISTS "${DB_NAME}" WITH (FORCE)`);
    } finally {
      await maintenance.end();
    }
  });

  async function executing(tenantId?: string, overrides: Record<string, unknown> = {}) {
    const opened = await engine.open(openInput(tenantId, overrides));
    await engine.decide(opened.id, { decision: 'grant', decidedBy: 'usr_bob' });
    expect(await engine.claim(opened.id)).toBe(true);
    return opened;
  }

  it('claim without outcome: nothing before the lease, failed RECOVERY_REQUIRED at the lease, idempotent', async () => {
    now = T0;
    const stuck = await executing();
    now = T0 + EXECUTING_LEASE_MS - 1;
    expect(await engine.recoverStale()).toEqual([]);
    expect((await engine.byId(stuck.id))?.status).toBe('executing');

    now = T0 + EXECUTING_LEASE_MS;
    const recovered = await engine.recoverStale();
    expect(recovered.map((r) => r.id)).toEqual([stuck.id]);
    const after = await engine.byId(stuck.id);
    expect(after).toMatchObject({ status: 'failed', error: APPROVAL_RECOVERY_REQUIRED_ERROR });
    expect(isRecoveryRequired(after!)).toBe(true);
    // repeated recovery reports nothing (each recovery audited once)
    expect(await engine.recoverStale()).toEqual([]);
    // never re-claimable, and a late outcome from the dead process is ignored
    expect(await engine.claim(stuck.id)).toBe(false);
    await engine.recordOutcome(stuck.id, { status: 'completed', result: { late: true } });
    expect((await engine.byId(stuck.id))?.status).toBe('failed');
  });

  it('concurrent sweepers: exactly one wins each row', async () => {
    now = T0;
    const stuck = await executing();
    now = T0 + EXECUTING_LEASE_MS + 1;
    const results = await Promise.all([1, 2, 3, 4].map(() => engine.recoverStale()));
    expect(results.flat().filter((r) => r.id === stuck.id)).toHaveLength(1);
  });

  it('never touches completed, failed, rejected, expired, approved or awaiting rows', async () => {
    now = T0;
    const completed = await executing();
    await engine.recordOutcome(completed.id, { status: 'completed', result: { ok: true } });
    const failed = await executing();
    await engine.recordOutcome(failed.id, { status: 'failed', error: 'boom' });
    const rejected = await engine.open(openInput());
    await engine.decide(rejected.id, { decision: 'reject', decidedBy: 'usr_bob' });
    const expired = await engine.open(openInput('org_rec_a', { ttlMs: 1000 }));
    const approved = await engine.open(openInput());
    await engine.decide(approved.id, { decision: 'grant', decidedBy: 'usr_bob' });
    const awaiting = await engine.open(openInput());
    now = T0 + 5000;
    await engine.expire(expired.id);
    now = T0 + EXECUTING_LEASE_MS * 3;
    expect((await engine.recoverStale()).map((r) => r.id)).not.toEqual(
      expect.arrayContaining([completed.id, failed.id, rejected.id, expired.id, approved.id]),
    );
    expect((await engine.byId(completed.id))?.status).toBe('completed');
    expect(await engine.byId(failed.id)).toMatchObject({ status: 'failed', error: 'boom' });
    expect((await engine.byId(rejected.id))?.status).toBe('rejected');
    expect((await engine.byId(approved.id))?.status).toBe('approved');
    expect((await engine.byId(awaiting.id))?.status).toBe('awaiting_approval');
    const raw = async (id: string) =>
      (await pool.query('SELECT status FROM approval_requests WHERE id = $1', [id])).rows[0].status;
    expect(await raw(approved.id)).toBe('approved');
    expect(await raw(expired.id)).toBe('expired');
    expect(await raw(awaiting.id)).toBe('awaiting_approval');
  });

  it('an executing approval past its expiry recovers as failed, not expired', async () => {
    now = T0;
    const stuck = await executing('org_rec_a', { ttlMs: 60_000 });
    now = T0 + EXECUTING_LEASE_MS + 120_000;
    expect(await engine.expireDue()).toEqual([]);
    const recovered = await engine.recoverStale();
    expect(recovered.map((r) => r.id)).toContain(stuck.id);
    expect((await engine.byId(stuck.id))?.status).toBe('failed');
  });

  it('a new approval can be requested for the same action after recovery (resume key attempt)', async () => {
    now = T0;
    const first = await executing('org_rec_b', { resumeKey: 'expense:abc' });
    now = T0 + EXECUTING_LEASE_MS + 1;
    await engine.recoverStale();
    const second = await engine.open(openInput('org_rec_b', { resumeKey: 'expense:abc' }));
    expect(second.id).not.toBe(first.id);
    expect(second.status).toBe('awaiting_approval');
  });

  it('honors an injected lease', async () => {
    now = T0;
    const short = new PgApprovalEngine(db, {
      clock: { now: () => new Date(now) },
      executingLeaseMs: 1000,
    });
    const opened = await short.open(openInput('org_rec_c'));
    await short.decide(opened.id, { decision: 'grant', decidedBy: 'usr_bob' });
    await short.claim(opened.id);
    now = T0 + 1000;
    expect((await short.recoverStale()).map((r) => r.id)).toEqual([opened.id]);
  });
});
