/**
 * Prompt 7 — runtime run persistence (PostgreSQL). Runs against a THROWAWAY
 * database created from the repo migrations (so migration 0022 — the
 * `runtime_runs` table and its indexes — is exercised) and skips cleanly when
 * Postgres is unreachable. Verifies the append-only contract, the full-record
 * round trip, tenant isolation, every list filter, ordering and the limit.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Pool } from 'pg';
import { createDatabaseFromPool, runMigrations, type NexoraDatabase } from '@nexora/persistence';
import {
  InMemoryRuntimeRunRepository,
  findForbiddenKeys,
  findSecrets,
  type RuntimeRun,
} from '@nexora/module-observability';

import { PgRuntimeRunRepository } from '../src/observability/pg-runtime-run-repository.js';

const BASE_URL =
  process.env.TEST_DATABASE_URL ??
  process.env.API_TEST_DATABASE_URL ??
  'postgres://nexora:nexora_dev_password@localhost:5433/nexora_api_test';
const DB_NAME = 'nexora_runtime_runs_pg_test';

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

const ORG_A = 'org_pg_runs_a';
const ORG_B = 'org_pg_runs_b';
const WS_1 = 'wsp_pg_runs_1';
const WS_2 = 'wsp_pg_runs_2';

let seq = 0;
function run(overrides: Partial<RuntimeRun> = {}): RuntimeRun {
  seq += 1;
  const startedAt = `2026-09-01T09:00:${String(seq % 60).padStart(2, '0')}.000Z`;
  return {
    id: `run_pg_${String(seq).padStart(4, '0')}`,
    tenantId: ORG_A,
    workspaceId: WS_1,
    requestId: `req-${seq}`,
    correlationId: 'corr_pg',
    actorId: 'usr_pg_1',
    origin: 'chat',
    startedAt,
    endedAt: new Date(new Date(startedAt).getTime() + 120).toISOString(),
    durationMs: 120.5,
    status: 'completed',
    stages: [
      { stage: 'REQUEST', durationMs: 1, count: 1 },
      { stage: 'EXECUTION', durationMs: 90, count: 1 },
    ],
    models: [],
    tools: [],
    retrievals: [],
    policies: [],
    tokenUsage: { available: false, promptTokens: 0, completionTokens: 0, totalTokens: 0 },
    cost: { estimated: null },
    schemaVersion: 1,
    ...overrides,
  };
}

const full = (): RuntimeRun =>
  run({
    agentId: 'agt_pg_1',
    delegationId: 'dlg_pg_1',
    origin: 'agent',
    status: 'failed',
    failure: {
      stage: 'POLICY',
      code: 'POLICY_DENIED',
      class: 'DENIED',
      sourceCode: 'POLICY_DENIED',
      toolId: 'calendar.create_event',
      invocationId: 'inv_pg_1',
    },
    stages: [
      { stage: 'REQUEST', durationMs: 1.25, count: 1 },
      { stage: 'POLICY', durationMs: 4, count: 1 },
      { stage: 'NARRATION', durationMs: 12.5, count: 1 },
    ],
    models: [
      {
        callId: 'mdl_pg_1',
        purpose: 'narration',
        provider: 'ollama',
        model: 'llama3',
        execution: 'local',
        startOffsetMs: 10,
        durationMs: 12.5,
        status: 'succeeded',
        retries: 0,
        usageAvailable: true,
        promptTokens: 10,
        completionTokens: 5,
        totalTokens: 15,
        cost: 0.0004,
        currency: 'USD',
        pricingVersion: 'v1',
        narrationSource: 'model',
        inputFingerprint: 'a'.repeat(64),
        outputFingerprint: 'b'.repeat(64),
      },
    ],
    tools: [
      {
        invocationId: 'inv_pg_1',
        toolId: 'calendar.create_event',
        origin: 'agent',
        startOffsetMs: 5,
        durationMs: 30,
        status: 'failed',
        errorCode: 'POLICY_DENIED',
        attempts: 1,
        retries: [],
        verified: false,
        verificationMs: 0,
        policy: { policyId: 'POLICY_TEST', version: '1', outcome: 'DENY' },
        delegationId: 'dlg_pg_1',
      },
    ],
    retrievals: [
      {
        retrievalId: 'rtv_pg_1',
        invocationId: 'inv_pg_2',
        toolId: 'knowledge.search',
        sourceType: 'knowledge',
        resultCount: 3,
        durationMs: 8,
        status: 'succeeded',
      },
    ],
    policies: [
      { policyId: 'POLICY_TEST', version: '1', outcome: 'DENY', phase: 'precheck', durationMs: 4 },
    ],
    approval: {
      approvalId: 'apr_pg_1',
      state: 'resumed',
      createdAt: '2026-09-01T09:00:00.000Z',
      decidedAt: '2026-09-01T09:00:05.000Z',
      waitMs: 5000,
      decision: 'grant',
    },
    verified: false,
    provider: 'ollama',
    model: 'llama3',
    modelExecution: 'local',
    tokenUsage: { available: true, promptTokens: 10, completionTokens: 5, totalTokens: 15 },
    cost: { estimated: 0.0004, currency: 'USD', pricingVersion: 'v1' },
  });

describeDb('runtime runs persistence (PostgreSQL)', () => {
  let pool: Pool;
  let db: NexoraDatabase;
  let repo: PgRuntimeRunRepository;

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
    repo = new PgRuntimeRunRepository(db);
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

  it('migration 0022 created runtime_runs', async () => {
    const result = await pool.query(
      `SELECT column_name FROM information_schema.columns WHERE table_name = 'runtime_runs'`,
    );
    const columns = result.rows.map((row: { column_name: string }) => row.column_name);
    expect(columns).toEqual(expect.arrayContaining(['id', 'tenant_id', 'record', 'failure_class']));
  });

  it('append/get/list round-trips the FULL record unchanged', async () => {
    const original = full();
    await repo.append(original);
    expect(await repo.get(ORG_A, original.id)).toEqual(original);
    const listed = await repo.list(ORG_A, { requestId: original.requestId! });
    expect(listed).toEqual([original]);
    // The record carries only ids/codes/durations/fingerprints.
    expect(findForbiddenKeys(original)).toEqual([]);
    expect(findSecrets(await repo.get(ORG_A, original.id))).toEqual([]);
  });

  it('is append-only: a duplicate id is rejected without changing history; no update/delete API', async () => {
    const original = run({ status: 'completed' });
    await repo.append(original);
    await expect(repo.append({ ...original, status: 'failed' })).rejects.toThrow();
    expect((await repo.get(ORG_A, original.id))?.status).toBe('completed');
    const api = Object.getOwnPropertyNames(PgRuntimeRunRepository.prototype).sort();
    expect(api).toEqual(['append', 'constructor', 'get', 'list']);
  });

  it('is tenant-scoped: a foreign tenant sees neither the list nor the run', async () => {
    const mine = run({ tenantId: ORG_A });
    const theirs = run({ tenantId: ORG_B, workspaceId: 'wsp_pg_runs_b' });
    await repo.append(mine);
    await repo.append(theirs);
    expect(await repo.get(ORG_B, mine.id)).toBeUndefined();
    expect(await repo.get(ORG_A, theirs.id)).toBeUndefined();
    expect(await repo.get(ORG_A, 'run_never_existed')).toBeUndefined();
    const aIds = (await repo.list(ORG_A, { limit: 1000 })).map((r) => r.id);
    const bIds = (await repo.list(ORG_B, { limit: 1000 })).map((r) => r.id);
    expect(aIds).toContain(mine.id);
    expect(aIds).not.toContain(theirs.id);
    expect(bIds).toContain(theirs.id);
    expect(bIds).not.toContain(mine.id);
    // A workspace filter of another tenant's workspace cannot widen the tenant.
    expect(await repo.list(ORG_A, { workspaceId: 'wsp_pg_runs_b' })).toEqual([]);
  });

  it('every list filter narrows correctly', async () => {
    const tag = `flt_${seq}`;
    const base = { tenantId: 'org_pg_runs_filters' };
    const rows = [
      run({
        ...base,
        workspaceId: WS_1,
        actorId: `${tag}_u1`,
        status: 'completed',
        provider: 'groq',
        model: 'm-a',
      }),
      run({
        ...base,
        workspaceId: WS_2,
        actorId: `${tag}_u2`,
        status: 'failed',
        origin: 'mcp',
        failure: { stage: 'EXECUTION', code: 'TOOL_EXECUTION_FAILED', class: 'EXECUTION' },
      }),
      run({
        ...base,
        workspaceId: WS_1,
        status: 'blocked',
        agentId: `${tag}_agent`,
        origin: 'agent',
      }),
      run({
        ...base,
        workspaceId: WS_1,
        status: 'failed',
        failure: { stage: 'POLICY', code: 'POLICY_DENIED', class: 'DENIED' },
      }),
    ];
    for (const r of rows) await repo.append(r);
    const ids = async (query: Parameters<PgRuntimeRunRepository['list']>[1]) =>
      (await repo.list(base.tenantId, query)).map((r) => r.id).sort();
    const idsOf = (...indexes: number[]) => indexes.map((i) => rows[i]!.id).sort();

    expect(await ids({})).toEqual(idsOf(0, 1, 2, 3));
    expect(await ids({ workspaceId: WS_2 })).toEqual(idsOf(1));
    expect(await ids({ status: 'completed' })).toEqual(idsOf(0));
    expect(await ids({ status: 'failed' })).toEqual(idsOf(1, 3));
    expect(await ids({ status: 'blocked' })).toEqual(idsOf(2));
    expect(await ids({ failureStage: 'POLICY' })).toEqual(idsOf(3));
    expect(await ids({ failureStage: 'EXECUTION' })).toEqual(idsOf(1));
    expect(await ids({ failureClass: 'DENIED' })).toEqual(idsOf(3));
    expect(await ids({ failureClass: 'EXECUTION' })).toEqual(idsOf(1));
    expect(await ids({ provider: 'groq' })).toEqual(idsOf(0));
    expect(await ids({ model: 'm-a' })).toEqual(idsOf(0));
    expect(await ids({ agentId: `${tag}_agent` })).toEqual(idsOf(2));
    expect(await ids({ actorId: `${tag}_u2` })).toEqual(idsOf(1));
    expect(await ids({ origin: 'mcp' })).toEqual(idsOf(1));
    expect(await ids({ origin: 'agent' })).toEqual(idsOf(2));
    expect(await ids({ requestId: rows[3]!.requestId! })).toEqual(idsOf(3));
    expect(await ids({ status: 'failed', workspaceId: WS_1 })).toEqual(idsOf(3));
    // Time window on startedAt (inclusive bounds).
    expect(await ids({ from: rows[1]!.startedAt, to: rows[2]!.startedAt })).toEqual(idsOf(1, 2));
    expect(await ids({ from: rows[3]!.startedAt })).toEqual(idsOf(3));
    expect(await ids({ to: rows[0]!.startedAt })).toEqual(idsOf(0));
    expect(await ids({ from: '2030-01-01T00:00:00.000Z' })).toEqual([]);
  });

  it('correlation filters: approvalId (run approval OR tool approval) and invocationId — same answers as the in-memory repository', async () => {
    const tenantId = 'org_pg_runs_corr';
    const tool = (invocationId: string, approvalId?: string) => ({
      invocationId,
      toolId: 'calendar.create_event',
      origin: 'orchestrator',
      startOffsetMs: 1,
      durationMs: 2,
      status: 'succeeded' as const,
      attempts: 1,
      retries: [],
      verified: true,
      verificationMs: 0,
      ...(approvalId === undefined ? {} : { approvalId }),
    });
    const rows = [
      // opened the gate (approval on the run, no tool ran)
      run({
        tenantId,
        tools: [],
        approval: {
          approvalId: 'apr_corr_a',
          state: 'opened',
          createdAt: '2026-09-01T09:00:00.000Z',
        },
      }),
      // resumed + executed (approval on the run AND on the tool)
      run({
        tenantId,
        tools: [tool('inv_corr_1', 'apr_corr_a')],
        approval: { approvalId: 'apr_corr_a', state: 'resumed' },
      }),
      // a different approval, and an execution with no approval at all
      run({
        tenantId,
        tools: [tool('inv_corr_2', 'apr_corr_b')],
        approval: { approvalId: 'apr_corr_b', state: 'resumed' },
      }),
      run({ tenantId, tools: [tool('inv_corr_3')], approval: undefined }),
    ];
    const memory = new InMemoryRuntimeRunRepository();
    for (const r of rows) {
      await repo.append(r);
      await memory.append(r);
    }
    const idsOf = (...indexes: number[]) => indexes.map((i) => rows[i]!.id).sort();
    for (const repository of [repo, memory]) {
      const ids = async (query: Parameters<PgRuntimeRunRepository['list']>[1]) =>
        (await repository.list(tenantId, query)).map((r) => r.id).sort();
      expect(await ids({ approvalId: 'apr_corr_a' })).toEqual(idsOf(0, 1));
      expect(await ids({ approvalId: 'apr_corr_b' })).toEqual(idsOf(2));
      expect(await ids({ approvalId: 'apr_unknown' })).toEqual([]);
      expect(await ids({ invocationId: 'inv_corr_1' })).toEqual(idsOf(1));
      expect(await ids({ invocationId: 'inv_corr_3' })).toEqual(idsOf(3));
      expect(await ids({ invocationId: 'inv_unknown' })).toEqual([]);
      expect(await ids({ approvalId: 'apr_corr_a', invocationId: 'inv_corr_1' })).toEqual(idsOf(1));
      // Tenant scope: the same ids in another tenant match nothing.
      expect(
        (await repository.list('org_pg_runs_corr_foreign', { approvalId: 'apr_corr_a' })).length,
      ).toBe(0);
    }
  });

  it('orders newest first (id breaks ties) and applies the limit', async () => {
    const tenantId = 'org_pg_runs_order';
    const t = (s: number) => `2026-09-02T10:00:${String(s).padStart(2, '0')}.000Z`;
    const oldest = run({ tenantId, id: 'run_ord_a', startedAt: t(1) });
    const tieLow = run({ tenantId, id: 'run_ord_b', startedAt: t(2) });
    const tieHigh = run({ tenantId, id: 'run_ord_c', startedAt: t(2) });
    const newest = run({ tenantId, id: 'run_ord_d', startedAt: t(3) });
    for (const r of [tieLow, newest, oldest, tieHigh]) await repo.append(r);

    expect((await repo.list(tenantId)).map((r) => r.id)).toEqual([
      'run_ord_d',
      'run_ord_c',
      'run_ord_b',
      'run_ord_a',
    ]);
    expect((await repo.list(tenantId, { limit: 2 })).map((r) => r.id)).toEqual([
      'run_ord_d',
      'run_ord_c',
    ]);
    expect(await repo.list(tenantId, { limit: 1 })).toHaveLength(1);
  });
});
