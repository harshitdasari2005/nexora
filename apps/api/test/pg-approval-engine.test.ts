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

  it('listByTenant narrows by status BEFORE the limit — an old pending approval is not crowded out by newer decided ones', async () => {
    const engine = new PgApprovalEngine(db);
    const TENANT_LIST = 'org_status_window';
    const oldPending = await engine.open(
      openInput({ tenantId: TENANT_LIST, input: { title: 'old pending' } }),
    );
    for (let index = 0; index < 5; index += 1) {
      const newer = await engine.open(
        openInput({ tenantId: TENANT_LIST, input: { title: `newer ${index}` } }),
      );
      await engine.decide(newer.id, { decision: 'reject', decidedBy: USER });
    }
    // Unfiltered newest-3: the old pending approval is NOT in the window (the bug's shape)…
    const crowded = await engine.listByTenant(TENANT_LIST, { limit: 3 });
    expect(crowded.map((record) => record.id)).not.toContain(oldPending.id);
    // …but a status filter is applied before the limit, so it is found.
    const pending = await engine.listByTenant(TENANT_LIST, {
      limit: 3,
      statuses: ['awaiting_approval'],
    });
    expect(pending.map((record) => record.id)).toEqual([oldPending.id]);
    expect(await engine.listByTenant(TENANT_LIST, { limit: 3, statuses: [] })).toEqual([]);
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

  it('the state machine is enforced in SQL: invalid transitions affect 0 rows', async () => {
    const engine = new PgApprovalEngine(db);
    const rawStatus = async (id: string): Promise<string> =>
      (await pool.query('SELECT status FROM approval_requests WHERE id = $1', [id])).rows[0].status;
    const grant = { decision: 'grant', decidedBy: USER } as const;

    // rejected → executing
    const rejected = await engine.open(openInput({ input: { title: 'sm-rejected' } }));
    await engine.decide(rejected.id, { decision: 'reject', decidedBy: USER });
    expect(await engine.claim(rejected.id)).toBe(false);
    expect(await rawStatus(rejected.id)).toBe('rejected');

    // expired → executing (an expired approval is never claimable)
    let now = Date.parse('2026-09-01T09:00:00.000Z');
    const clocked = new PgApprovalEngine(db, { clock: { now: () => new Date(now) } });
    const expiring = await clocked.open(openInput({ input: { title: 'sm-expired' }, ttlMs: 1000 }));
    await clocked.decide(expiring.id, grant);
    now += 5_000;
    await clocked.expire(expiring.id);
    expect(await rawStatus(expiring.id)).toBe('expired');
    expect(await engine.claim(expiring.id)).toBe(false);
    expect(await rawStatus(expiring.id)).toBe('expired');

    // completed → approved (a completed approval can never be re-decided)
    const completed = await engine.open(openInput({ input: { title: 'sm-completed' } }));
    await engine.decide(completed.id, grant);
    expect(await engine.claim(completed.id)).toBe(true);
    // executing → approved (cannot be re-decided mid-flight)
    expect(await engine.decide(completed.id, grant)).toEqual({
      ok: false,
      reason: 'already_decided',
    });
    expect(await rawStatus(completed.id)).toBe('executing');
    await engine.recordOutcome(completed.id, { status: 'completed', result: { ok: true } });
    expect(await rawStatus(completed.id)).toBe('completed');
    expect(await engine.decide(completed.id, grant)).toEqual({
      ok: false,
      reason: 'already_decided',
    });
    expect(await engine.decide(completed.id, { decision: 'reject', decidedBy: USER })).toEqual({
      ok: false,
      reason: 'already_decided',
    });
    // completed → failed / completed → executing are equally impossible.
    await engine.recordOutcome(completed.id, { status: 'failed', error: 'late' });
    expect(await engine.claim(completed.id)).toBe(false);
    expect(await rawStatus(completed.id)).toBe('completed');
  });

  describe('resume-key attempts: a terminal approval never blocks a new request', () => {
    const grant = { decision: 'grant', decidedBy: USER } as const;

    it('rejected → re-request opens a NEW approval under `<key>:2`; the terminal one is untouched', async () => {
      const engine = new PgApprovalEngine(db);
      const key = 'resume_attempt_rejected';
      const first = await engine.open(openInput({ resumeKey: key, input: { title: 'a' } }));
      await engine.decide(first.id, { decision: 'reject', decidedBy: USER });
      const second = await engine.open(openInput({ resumeKey: key, input: { title: 'a' } }));
      expect(second.id).not.toBe(first.id);
      expect(second.status).toBe('awaiting_approval');
      expect(second.resumeKey).toBe(`${key}:2`);
      expect((await engine.byId(first.id))?.status).toBe('rejected');
      // While the new attempt is live, a further request reuses IT (dedupe intact).
      const again = await engine.open(openInput({ resumeKey: key, input: { title: 'a' } }));
      expect(again.id).toBe(second.id);
      // The base key still names the terminal record; the attempt key the live one.
      expect((await engine.byResumeKey(TENANT, key))?.id).toBe(first.id);
      expect((await engine.byResumeKey(TENANT, `${key}:2`))?.id).toBe(second.id);
    });

    it('expired → re-request works, and a second terminal moves on to `:3`', async () => {
      let now = Date.parse('2026-09-01T09:00:00.000Z');
      const engine = new PgApprovalEngine(db, { clock: { now: () => new Date(now) } });
      const key = 'resume_attempt_expired';
      const first = await engine.open(openInput({ resumeKey: key, ttlMs: 1000 }));
      now += 5_000;
      await engine.expire(first.id);
      const second = await engine.open(openInput({ resumeKey: key, ttlMs: 60_000 }));
      expect(second.id).not.toBe(first.id);
      expect(second.resumeKey).toBe(`${key}:2`);
      await engine.decide(second.id, { decision: 'reject', decidedBy: USER });
      const third = await engine.open(openInput({ resumeKey: key }));
      expect(third.resumeKey).toBe(`${key}:3`);
      expect(new Set([first.id, second.id, third.id]).size).toBe(3);
    });

    it('failed → re-request works; completed replays (never a second approval)', async () => {
      const engine = new PgApprovalEngine(db);
      const failedKey = 'resume_attempt_failed';
      const failed = await engine.open(openInput({ resumeKey: failedKey }));
      await engine.decide(failed.id, grant);
      expect(await engine.claim(failed.id)).toBe(true);
      await engine.recordOutcome(failed.id, { status: 'failed', error: 'boom' });
      const retry = await engine.open(openInput({ resumeKey: failedKey }));
      expect(retry.id).not.toBe(failed.id);
      expect(retry.resumeKey).toBe(`${failedKey}:2`);

      const doneKey = 'resume_attempt_completed';
      const done = await engine.open(openInput({ resumeKey: doneKey }));
      await engine.decide(done.id, grant);
      await engine.claim(done.id);
      await engine.recordOutcome(done.id, { status: 'completed', result: { id: 1 } });
      const replay = await engine.open(openInput({ resumeKey: doneKey }));
      expect(replay.id).toBe(done.id);
      expect(replay.status).toBe('completed');
    });
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

  describe('expiry, approver authority and the injectable clock', () => {
    const T0 = Date.parse('2026-09-01T09:00:00.000Z');
    function clocked(): { engine: PgApprovalEngine; set: (ms: number) => void } {
      let now = T0;
      return {
        engine: new PgApprovalEngine(db, { clock: { now: () => new Date(now) } }),
        set: (ms) => {
          now = ms;
        },
      };
    }
    const rawStatus = async (id: string): Promise<string> =>
      (await pool.query('SELECT status FROM approval_requests WHERE id = $1', [id])).rows[0].status;

    it('open records expiry, required approver role and separation of duties (default TTL 24h)', async () => {
      const { engine } = clocked();
      const plain = await engine.open(openInput({ runId: 'run_exp_1' }));
      expect(plain.createdAt).toBe('2026-09-01T09:00:00.000Z');
      expect(plain.expiresAt).toBe('2026-09-02T09:00:00.000Z');
      expect(plain.separationOfDuties).toBe(false);
      expect(plain.requiredApproverRoleId).toBeUndefined();

      const governed = await engine.open(
        openInput({
          runId: 'run_exp_2',
          ttlMs: 60_000,
          requiredApproverRoleId: 'finance.cfo',
          separationOfDuties: true,
        }),
      );
      const stored = await engine.byId(governed.id);
      expect(stored).toMatchObject({
        expiresAt: '2026-09-01T09:01:00.000Z',
        requiredApproverRoleId: 'finance.cfo',
        separationOfDuties: true,
      });

      const absolute = await engine.open(
        openInput({ runId: 'run_exp_3', expiresAt: '2026-09-01T10:00:00.000Z', ttlMs: 5 }),
      );
      expect((await engine.byId(absolute.id))?.expiresAt).toBe('2026-09-01T10:00:00.000Z');
    });

    it('decide succeeds strictly before expiry and refuses at/after it (exactly one transition)', async () => {
      const { engine, set } = clocked();
      const a = await engine.open(openInput({ runId: 'run_exp_4', ttlMs: 1000 }));
      set(T0 + 999);
      expect((await engine.decide(a.id, { decision: 'grant', decidedBy: USER })).ok).toBe(true);

      set(T0);
      const b = await engine.open(openInput({ runId: 'run_exp_5', ttlMs: 1000 }));
      set(T0 + 1000); // now >= expiresAt
      const first = await engine.decide(b.id, { decision: 'grant', decidedBy: USER });
      expect(first).toMatchObject({ ok: false, reason: 'expired', transitioned: true });
      const second = await engine.decide(b.id, { decision: 'grant', decidedBy: USER });
      expect(second).toMatchObject({ ok: false, reason: 'expired', transitioned: false });
      expect(await rawStatus(b.id)).toBe('expired');
      expect(await engine.decisionStatus(b.id)).toBe('expired');
      expect(await engine.claim(b.id)).toBe(false);
    });

    it('reads are pure: a due approval reads expired but is only persisted by expire/expireDue/decide', async () => {
      const { engine, set } = clocked();
      const a = await engine.open(openInput({ runId: 'run_exp_6', ttlMs: 1000 }));
      set(T0 + 5000);
      expect((await engine.byId(a.id))?.status).toBe('expired');
      expect(await engine.decisionStatus(a.id)).toBe('expired');
      expect((await engine.listByConversation('conv_1')).some((r) => r.id === a.id)).toBe(true);
      expect(await rawStatus(a.id)).toBe('awaiting_approval'); // nothing persisted by reads
      const expired = await engine.expire(a.id);
      expect(expired.transitioned).toBe(true);
      expect(expired.record?.status).toBe('expired');
      expect(await rawStatus(a.id)).toBe('expired');
      expect((await engine.expire(a.id)).transitioned).toBe(false);
      expect((await engine.expire('apr_missing')).record).toBeUndefined();
    });

    it('an approved-but-unclaimed approval expires: claim refuses and expire transitions it', async () => {
      const { engine, set } = clocked();
      const a = await engine.open(openInput({ runId: 'run_exp_7', ttlMs: 10_000 }));
      await engine.decide(a.id, { decision: 'grant', decidedBy: USER });
      set(T0 + 10_000);
      expect(await engine.claim(a.id)).toBe(false);
      expect(await engine.decisionStatus(a.id)).toBe('expired');
      expect((await engine.expire(a.id)).transitioned).toBe(true);
    });

    it('expireDue sweeps only due, expirable approvals and returns each transition once', async () => {
      const { engine, set } = clocked();
      const due = await engine.open(openInput({ runId: 'run_sw_1', ttlMs: 1000 }));
      const approvedDue = await engine.open(openInput({ runId: 'run_sw_2', ttlMs: 1000 }));
      await engine.decide(approvedDue.id, { decision: 'grant', decidedBy: USER });
      const notDue = await engine.open(openInput({ runId: 'run_sw_3', ttlMs: 3_600_000 }));
      const rejected = await engine.open(openInput({ runId: 'run_sw_4', ttlMs: 1000 }));
      await engine.decide(rejected.id, { decision: 'reject', decidedBy: USER });
      const executing = await engine.open(openInput({ runId: 'run_sw_5', ttlMs: 1000 }));
      await engine.decide(executing.id, { decision: 'grant', decidedBy: USER });
      expect(await engine.claim(executing.id)).toBe(true);
      const completed = await engine.open(openInput({ runId: 'run_sw_6', ttlMs: 1000 }));
      await engine.decide(completed.id, { decision: 'grant', decidedBy: USER });
      await engine.claim(completed.id);
      await engine.recordOutcome(completed.id, { status: 'completed', result: {} });

      set(T0 + 2000);
      const swept = await engine.expireDue();
      const ids = swept.map((r) => r.id);
      expect(ids).toEqual(expect.arrayContaining([due.id, approvedDue.id]));
      expect(ids).not.toContain(notDue.id);
      expect(ids).not.toContain(rejected.id);
      expect(ids).not.toContain(executing.id);
      expect(ids).not.toContain(completed.id);
      expect(swept.every((r) => r.status === 'expired')).toBe(true);
      // Idempotent: a second sweep returns nothing.
      expect(await engine.expireDue()).toEqual([]);
      expect(await rawStatus(rejected.id)).toBe('rejected');
      expect(await rawStatus(executing.id)).toBe('executing');
      expect(await rawStatus(completed.id)).toBe('completed');
      expect(await rawStatus(notDue.id)).toBe('awaiting_approval');
    });

    it('concurrent decide/expire at the deadline: exactly ONE caller observes transitioned', async () => {
      const { engine, set } = clocked();
      const a = await engine.open(openInput({ runId: 'run_exp_8', ttlMs: 1000 }));
      set(T0 + 1000);
      const results = await Promise.all([
        engine.decide(a.id, { decision: 'grant', decidedBy: USER }),
        engine.decide(a.id, { decision: 'reject', decidedBy: USER }),
        engine.expire(a.id),
      ]);
      const transitions = results.filter((r) => 'transitioned' in r && r.transitioned === true);
      expect(transitions).toHaveLength(1);
      expect(await rawStatus(a.id)).toBe('expired');
    });

    it('a legacy row with NULL expires_at expires at created_at + 24h', async () => {
      const { engine, set } = clocked();
      const a = await engine.open(openInput({ runId: 'run_legacy' }));
      await pool.query('UPDATE approval_requests SET expires_at = NULL WHERE id = $1', [a.id]);
      expect((await engine.byId(a.id))?.expiresAt).toBe('2026-09-02T09:00:00.000Z');
      set(T0 + 24 * 3600 * 1000 - 1);
      expect(await engine.decisionStatus(a.id)).toBe('pending');
      set(T0 + 24 * 3600 * 1000);
      expect(await engine.decisionStatus(a.id)).toBe('expired');
      expect(await engine.decide(a.id, { decision: 'grant', decidedBy: USER })).toMatchObject({
        ok: false,
        reason: 'expired',
        transitioned: true,
      });
    });
  });
});
