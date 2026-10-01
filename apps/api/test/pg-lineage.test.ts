/**
 * Prompt 6 — evidence + lineage persistence (PostgreSQL).
 *
 * Runs against a THROWAWAY database created from the repo migrations (so the
 * 0021 migration itself — table and tenant/run/approval/subject indexes — is
 * exercised) and skips cleanly when Postgres is unreachable. Verifies:
 * - lineage is INSERT-ONLY: the repository has no update/delete, and an id
 *   collision fails instead of overwriting history;
 * - a historical evidence record keeps the source version and fingerprint it
 *   was written with even after later records for the same source exist;
 * - reads are tenant-scoped, workspace narrows further, every filter works,
 *   and order is occurred_at, seq, id;
 * - structured facts round-trip unchanged (jsonb) and hold no raw content.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Pool } from 'pg';
import { createDatabaseFromPool, runMigrations, type NexoraDatabase } from '@nexora/persistence';

import type { LineageRecord } from '@nexora/module-lineage';
import { PgLineageRepository } from '../src/lineage/pg-lineage-repository.js';

const BASE_URL =
  process.env.TEST_DATABASE_URL ??
  process.env.API_TEST_DATABASE_URL ??
  'postgres://nexora:nexora_dev_password@localhost:5433/nexora_api_test';
const DB_NAME = 'nexora_lineage_pg_test';

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

const ORG_A = 'org_pg_lineage_a';
const ORG_B = 'org_pg_lineage_b';
const WS_1 = 'wsp_pg_lineage_1';
const WS_2 = 'wsp_pg_lineage_2';

let seq = 0;
function record(overrides: Partial<LineageRecord> & Pick<LineageRecord, 'kind'>): LineageRecord {
  seq += 1;
  return {
    id: `lin_pg_${seq}`,
    tenantId: ORG_A,
    workspaceId: WS_1,
    runId: 'run_pg_1',
    occurredAt: `2026-09-01T09:00:${String(seq % 60).padStart(2, '0')}.000Z`,
    seq,
    data: {},
    ...overrides,
  };
}

describeDb('lineage persistence (PostgreSQL)', () => {
  let pool: Pool;
  let db: NexoraDatabase;
  let repo: PgLineageRepository;

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
    repo = new PgLineageRepository(db);
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

  it('round-trips every kind with its links and structured facts unchanged', async () => {
    const evidence = record({
      kind: 'EVIDENCE',
      invocationId: 'inv_1',
      subjectType: 'KNOWLEDGE_ARTICLE',
      subjectId: 'art_policy',
      fingerprint: 'a'.repeat(64),
      data: {
        sourceType: 'KNOWLEDGE_ARTICLE',
        sourceId: 'art_policy',
        sourceVersion: 1,
        trust: 'KNOWLEDGE_CONTENT',
      },
    });
    const execution = record({
      kind: 'EXECUTION',
      invocationId: 'inv_1',
      approvalId: 'apr_1',
      agentId: 'agt_1',
      delegationId: 'dlg_1',
      actorId: 'usr_1',
      subjectType: 'tool',
      subjectId: 'finance.submit_expense',
      data: { status: 'succeeded', affectedResource: { type: 'expense', id: 'exp_1' } },
    });
    await repo.append([evidence, execution]);
    const found = await repo.list(ORG_A, { runId: 'run_pg_1' });
    expect(found).toEqual([evidence, execution]);
  });

  it('is insert-only: an id collision fails instead of overwriting history, and no update/delete API exists', async () => {
    const original = record({
      kind: 'EVIDENCE',
      subjectType: 'DOCUMENT',
      subjectId: 'doc_1',
      data: { sourceVersion: 1 },
    });
    await repo.append([original]);
    await expect(repo.append([{ ...original, data: { sourceVersion: 99 } }])).rejects.toThrow();
    expect((await repo.list(ORG_A, { subjectId: 'doc_1' }))[0]?.data).toEqual({ sourceVersion: 1 });
    const api = Object.getOwnPropertyNames(Object.getPrototypeOf(repo));
    expect(api.filter((name) => /update|delete|remove|save|upsert/i.test(name))).toEqual([]);
  });

  it('historical evidence keeps its source version and fingerprint after the source changes', async () => {
    const v1 = record({
      kind: 'EVIDENCE',
      subjectType: 'KNOWLEDGE_ARTICLE',
      subjectId: 'art_hist',
      fingerprint: '1'.repeat(64),
      data: { sourceVersion: 1 },
    });
    await repo.append([v1]);
    const v2 = record({
      kind: 'EVIDENCE',
      subjectType: 'KNOWLEDGE_ARTICLE',
      subjectId: 'art_hist',
      fingerprint: '2'.repeat(64),
      data: { sourceVersion: 2 },
    });
    await repo.append([v2]);
    const history = await repo.list(ORG_A, {
      kind: 'EVIDENCE',
      subjectType: 'KNOWLEDGE_ARTICLE',
      subjectId: 'art_hist',
    });
    expect(history.map((r) => [r.data['sourceVersion'], r.fingerprint])).toEqual([
      [1, '1'.repeat(64)],
      [2, '2'.repeat(64)],
    ]);
  });

  it('is tenant-scoped, and the workspace filter narrows further', async () => {
    const a = record({
      kind: 'EXECUTION',
      runId: 'run_scope',
      workspaceId: WS_1,
      subjectId: 'tool.a',
    });
    const b = record({
      kind: 'EXECUTION',
      runId: 'run_scope',
      workspaceId: WS_2,
      subjectId: 'tool.b',
    });
    const other = record({
      kind: 'EXECUTION',
      runId: 'run_scope',
      tenantId: ORG_B,
      workspaceId: WS_1,
      subjectId: 'tool.c',
    });
    await repo.append([a, b, other]);

    const tenantWide = await repo.list(ORG_A, { runId: 'run_scope' });
    expect(tenantWide.map((r) => r.subjectId).sort()).toEqual(['tool.a', 'tool.b']);
    expect(
      (await repo.list(ORG_A, { runId: 'run_scope', workspaceId: WS_2 })).map((r) => r.subjectId),
    ).toEqual(['tool.b']);
    // The other tenant never sees ORG_A's rows, and ORG_A never sees the other tenant's.
    expect((await repo.list(ORG_B, { runId: 'run_scope' })).map((r) => r.subjectId)).toEqual([
      'tool.c',
    ]);
    expect(await repo.list('org_pg_lineage_none', { runId: 'run_scope' })).toEqual([]);
  });

  it('filters by kind, subject, approval and invocation, orders by time then seq, and honours limit', async () => {
    const t = (s: number) => `2026-09-02T10:00:0${s}.000Z`;
    const rows = [
      record({
        kind: 'PLANNED_ACTION',
        runId: 'run_f',
        occurredAt: t(3),
        seq: 30,
        approvalId: 'apr_f',
        subjectId: 'tool.f',
      }),
      record({
        kind: 'EXECUTION',
        runId: 'run_f',
        occurredAt: t(1),
        seq: 10,
        approvalId: 'apr_f',
        invocationId: 'inv_f',
        subjectId: 'tool.f',
      }),
      record({
        kind: 'VERIFICATION',
        runId: 'run_f',
        occurredAt: t(1),
        seq: 11,
        invocationId: 'inv_f',
        subjectId: 'tool.f',
      }),
      record({ kind: 'LINK', runId: 'run_f', occurredAt: t(2), seq: 20, subjectId: 'x' }),
    ];
    await repo.append(rows);
    const all = await repo.list(ORG_A, { runId: 'run_f' });
    expect(all.map((r) => r.kind)).toEqual(['EXECUTION', 'VERIFICATION', 'LINK', 'PLANNED_ACTION']);
    expect((await repo.list(ORG_A, { runId: 'run_f', limit: 2 })).map((r) => r.kind)).toEqual([
      'EXECUTION',
      'VERIFICATION',
    ]);
    expect((await repo.list(ORG_A, { approvalId: 'apr_f' })).map((r) => r.kind)).toEqual([
      'EXECUTION',
      'PLANNED_ACTION',
    ]);
    expect((await repo.list(ORG_A, { invocationId: 'inv_f' })).map((r) => r.kind)).toEqual([
      'EXECUTION',
      'VERIFICATION',
    ]);
    expect(
      (await repo.list(ORG_A, { runId: 'run_f', kind: 'LINK' })).map((r) => r.subjectId),
    ).toEqual(['x']);
  });

  it('has the tenant-scoped indexes the trace joins rely on', async () => {
    const result = await pool.query(
      `SELECT indexname FROM pg_indexes WHERE tablename = 'lineage_records'`,
    );
    const names = result.rows.map((row: { indexname: string }) => row.indexname);
    for (const expected of [
      'lineage_tenant_run_idx',
      'lineage_tenant_approval_idx',
      'lineage_tenant_subject_idx',
      'lineage_tenant_invocation_idx',
    ]) {
      expect(names).toContain(expected);
    }
  });
});
