/**
 * S24 Phase 6 — durable approval engine (PostgreSQL) tests.
 *
 * Verifies the PgApprovalEngine behind the EXISTING ApprovalEngine
 * interface: durable lifecycle (open → decide → claim → outcome), atomic
 * exactly-once claim (concurrent workers — only ONE executes), duplicate
 * decision rejection, and the (tenant, resumeKey) cross-process resume
 * dedupe (a re-invocation of the same governed action resolves to the SAME
 * pending approval). Runs against a DEDICATED `nexora_api_test` database
 * (never the live dev database) and skips cleanly when Postgres is
 * unreachable, so `pnpm test` stays green without infra.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Pool } from 'pg';
import { createDatabaseFromPool, runMigrations, type NexoraDatabase } from '@nexora/persistence';
import { PgApprovalEngine } from '../src/ai/pg-approval-engine.js';

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

const TENANT = 'org_durable';
const USER = 'usr_alice';

function openInput(overrides: Record<string, unknown> = {}) {
  return {
    conversationId: 'conv_1',
    userId: USER,
    tenantId: TENANT,
    workspaceId: 'wsp_1',
    runId: 'run_1',
    stepId: 'calendar.create_event',
    toolId: 'calendar.create_event',
    capabilityId: 'calendar.create_event',
    sideEffectClass: 'consequential' as const,
    reason: 'Approval required',
    intent: 'Create a calendar event',
    input: {
      title: 'Payments Review',
      startsAt: '2026-08-16T10:00:00Z',
      endsAt: '2026-08-16T11:00:00Z',
    },
    ...overrides,
  };
}

describeDb('PgApprovalEngine (durable governance)', () => {
  let db: NexoraDatabase;
  let pool: Pool;

  beforeAll(async () => {
    // Create the dedicated test database if missing, apply migrations, and
    // connect. Never touches the live `nexora` dev database.
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
    // ONE pool owned by the test — the Drizzle client wraps it, so afterAll
    // can close every connection before dropping the test database (no
    // orphaned pool killed mid-flight by DROP DATABASE ... WITH (FORCE)).
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

  it('round-trips the full lifecycle (open → decide → claim → outcome)', async () => {
    const engine = new PgApprovalEngine(db);
    const opened = await engine.open(openInput());
    expect(opened.status).toBe('awaiting_approval');

    // byId + decisionStatus read the durable state.
    expect((await engine.byId(opened.id))?.tenantId).toBe(TENANT);
    expect(await engine.decisionStatus(opened.id)).toBe('pending');

    const decided = await engine.decide(opened.id, { decision: 'grant', decidedBy: USER });
    expect(decided.ok).toBe(true);
    expect(await engine.decisionStatus(opened.id)).toBe('granted');

    // Atomic claim: approved → executing.
    expect(await engine.claim(opened.id)).toBe(true);
    expect(await engine.claim(opened.id)).toBe(false); // already claimed
    const executing = await engine.byId(opened.id);
    expect(executing?.status).toBe('executing');
    expect(executing?.executedAt).toBeDefined();

    await engine.recordOutcome(opened.id, {
      status: 'completed',
      result: { event: { id: 'evt_1' } },
    });
    const completed = await engine.byId(opened.id);
    expect(completed?.status).toBe('completed');
    expect(completed?.result).toEqual({ event: { id: 'evt_1' } });
    // Post-grant states read as granted (idempotent re-delivery replay).
    expect(await engine.decisionStatus(opened.id)).toBe('granted');
  });

  it('a duplicate decision is rejected — a request can be decided exactly once', async () => {
    const engine = new PgApprovalEngine(db);
    const opened = await engine.open(openInput({ input: { title: 'Once' } }));
    expect((await engine.decide(opened.id, { decision: 'grant', decidedBy: USER })).ok).toBe(true);
    const second = await engine.decide(opened.id, { decision: 'reject', decidedBy: USER });
    expect(second).toEqual({ ok: false, reason: 'already_decided' });
  });

  it('rejects invalid transitions: a decided request cannot re-open for execution', async () => {
    const engine = new PgApprovalEngine(db);
    const opened = await engine.open(openInput({ input: { title: 'Deny' } }));
    await engine.decide(opened.id, { decision: 'reject', decidedBy: USER });
    // Rejected → executing is impossible (claim requires `approved`).
    expect(await engine.claim(opened.id)).toBe(false);
    // recordOutcome only transitions from `executing`.
    await engine.recordOutcome(opened.id, { status: 'completed', result: {} });
    expect((await engine.byId(opened.id))?.status).toBe('rejected');
  });

  it('an unknown approval id resolves to nothing (fail closed)', async () => {
    const engine = new PgApprovalEngine(db);
    expect(await engine.byId('apr_unknown')).toBeUndefined();
    expect(await engine.decisionStatus('apr_unknown')).toBeUndefined();
    expect(await engine.claim('apr_unknown')).toBe(false);
    expect(await engine.decide('apr_unknown', { decision: 'grant', decidedBy: USER })).toEqual({
      ok: false,
      reason: 'not_found',
    });
  });

  it('resume-key dedupe: a re-invocation resolves the SAME pending approval (cross-process resume)', async () => {
    const engine = new PgApprovalEngine(db);
    const key = 'resume_key_same_action';
    const first = await engine.open(
      openInput({ resumeKey: key, input: { title: 'Payments Review' } }),
    );
    // A second process opening the SAME governed action gets the SAME
    // approval (unique (tenant, resumeKey)) — never a duplicate pending gate.
    const second = await engine.open(
      openInput({ resumeKey: key, input: { title: 'Payments Review' } }),
    );
    expect(second.id).toBe(first.id);
    expect(await engine.byResumeKey(TENANT, key)).toBeDefined();
    expect((await engine.byResumeKey(TENANT, key))?.id).toBe(first.id);

    // A different tenant with the same key is a distinct approval (tenant scoping).
    const otherTenant = await engine.open(
      openInput({ tenantId: 'org_other', resumeKey: key, input: { title: 'X' } }),
    );
    expect(otherTenant.id).not.toBe(first.id);
    expect(await engine.byResumeKey('org_other', key)).toBeDefined();
  });

  it('concurrent claim: exactly ONE worker executes the same approved action', async () => {
    const engine = new PgApprovalEngine(db);
    const opened = await engine.open(openInput({ input: { title: 'Concurrent' } }));
    await engine.decide(opened.id, { decision: 'grant', decidedBy: USER });

    // Two workers race to claim the SAME approval. The atomic conditional
    // transition lets exactly one win.
    const [a, b] = await Promise.all([engine.claim(opened.id), engine.claim(opened.id)]);
    const winners = [a, b].filter(Boolean).length;
    expect(winners).toBe(1);

    const after = await engine.byId(opened.id);
    expect(after?.status).toBe('executing');
    // The loser cannot record a competing outcome (recordOutcome requires
    // `executing`, which only the winner's claim created — the winner's
    // outcome is authoritative).
    await engine.recordOutcome(opened.id, { status: 'completed', result: { winner: 'a' } });
    expect((await engine.byId(opened.id))?.status).toBe('completed');
  });

  it('lists approvals by conversation (audit trail) in creation order', async () => {
    const engine = new PgApprovalEngine(db);
    // A unique conversation id isolates this test from earlier approvals.
    const a = await engine.open(
      openInput({ conversationId: 'conv_list', input: { title: 'First' } }),
    );
    const b = await engine.open(
      openInput({ conversationId: 'conv_list', input: { title: 'Second' } }),
    );
    const listed = await engine.listByConversation('conv_list');
    expect(listed.map((record) => record.id)).toEqual([a.id, b.id]);
  });
});
