import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  InMemoryLineageRepository,
  canonicalJson,
  fingerprintOf,
  type ApprovedBy,
  type ExecutionData,
  type LineageRecord,
  type PlannedActionData,
  type VerificationData,
} from '../src/index.js';

function rec(over: Partial<LineageRecord> = {}): LineageRecord {
  return {
    id: 'lin_1',
    tenantId: 't1',
    workspaceId: 'w1',
    runId: 'run_1',
    kind: 'EVIDENCE',
    occurredAt: '2026-01-01T00:00:00.000Z',
    seq: 0,
    data: { a: 1 },
    ...over,
  };
}

async function ids(
  repo: InMemoryLineageRepository,
  tenant: string,
  query?: Parameters<InMemoryLineageRepository['list']>[1],
): Promise<string[]> {
  return (await repo.list(tenant, query)).map((r) => r.id);
}

describe('canonicalJson / fingerprintOf', () => {
  it('is independent of key order, including nested objects', () => {
    const a = { x: 1, y: { p: 1, q: [{ m: 1, n: 2 }] } };
    const b = { y: { q: [{ n: 2, m: 1 }], p: 1 }, x: 1 };
    expect(canonicalJson(a)).toBe(canonicalJson(b));
    expect(fingerprintOf(a)).toBe(fingerprintOf(b));
    expect(canonicalJson(a)).toBe('{"x":1,"y":{"p":1,"q":[{"m":1,"n":2}]}}');
  });

  it('drops undefined properties (control: null is kept)', () => {
    expect(canonicalJson({ a: 1, b: undefined })).toBe('{"a":1}');
    expect(fingerprintOf({ a: 1, b: undefined })).toBe(fingerprintOf({ a: 1 }));
    expect(canonicalJson({ a: 1, b: null })).toBe('{"a":1,"b":null}');
    expect(fingerprintOf({ a: 1, b: null })).not.toBe(fingerprintOf({ a: 1 }));
  });

  it('keeps array order', () => {
    expect(canonicalJson([1, 2, 3])).toBe('[1,2,3]');
    expect(fingerprintOf([1, 2, 3])).not.toBe(fingerprintOf([3, 2, 1]));
    expect(fingerprintOf([1, 2, 3])).toBe(fingerprintOf([1, 2, 3]));
  });

  it('differs for different values', () => {
    expect(fingerprintOf({ a: 1 })).not.toBe(fingerprintOf({ a: 2 }));
    expect(fingerprintOf({ a: 1 })).not.toBe(fingerprintOf({ b: 1 }));
    expect(fingerprintOf('1')).not.toBe(fingerprintOf(1));
  });

  it('produces a stable known digest', () => {
    expect(fingerprintOf({ b: 2, a: 1 })).toBe(
      createHash('sha256').update('{"a":1,"b":2}').digest('hex'),
    );
    expect(fingerprintOf({ a: 1, b: 2 })).toBe(
      '43258cff783fe7036d8a43033f830adfc60ec037382473548ac742b888292777',
    );
    expect(fingerprintOf({ a: 1 })).toMatch(/^[0-9a-f]{64}$/);
  });

  it('serializes undefined array items as null and never drops them (control: object keys are dropped)', () => {
    expect(canonicalJson([1, undefined, 2])).toBe('[1,null,2]');
    expect(canonicalJson({ a: [undefined] })).toBe('{"a":[null]}');
    expect(canonicalJson({ a: undefined })).toBe('{}');
  });

  it('sorts keys by code unit and treats nested key order in arrays of objects as irrelevant', () => {
    expect(canonicalJson({ b: 1, B: 2, a: 3 })).toBe('{"B":2,"a":3,"b":1}');
    expect(fingerprintOf([{ y: 1, x: 2 }])).toBe(fingerprintOf([{ x: 2, y: 1 }]));
    expect(fingerprintOf([{ y: 1, x: 2 }])).not.toBe(fingerprintOf([{ x: 1, y: 2 }]));
  });

  it('handles nulls', () => {
    expect(canonicalJson(null)).toBe('null');
    expect(canonicalJson({ n: null })).toBe('{"n":null}');
    expect(fingerprintOf(null)).toBe(createHash('sha256').update('null').digest('hex'));
    expect(fingerprintOf(undefined)).toBe(fingerprintOf(null));
  });

  // Regression: a Date has no own keys, so without special handling every Date
  // serialized to {} and different instants collided.
  it('different Dates produce different fingerprints', () => {
    const a = new Date('2026-01-01T00:00:00.000Z');
    const b = new Date('2027-06-01T00:00:00.000Z');
    expect(fingerprintOf({ at: a })).not.toBe(fingerprintOf({ at: b }));
  });

  it('a Date serializes as its ISO string', () => {
    const d = new Date('2026-01-01T00:00:00.000Z');
    expect(canonicalJson({ at: d })).toBe('{"at":"2026-01-01T00:00:00.000Z"}');
  });

  it('never equals the raw value', () => {
    for (const raw of ['secret snippet', 'abc', '']) {
      expect(fingerprintOf(raw)).not.toBe(raw);
      expect(fingerprintOf(raw)).not.toContain(raw || '\u0000');
    }
    expect(fingerprintOf('secret snippet')).not.toContain('secret');
  });
});

describe('InMemoryLineageRepository', () => {
  it('is append-only: exposes only append and list', () => {
    const repo = new InMemoryLineageRepository();
    const methods = [
      ...Object.getOwnPropertyNames(Object.getPrototypeOf(repo)),
      ...Object.getOwnPropertyNames(repo),
    ].filter((n) => n !== 'constructor');
    expect(methods.sort()).toEqual(['append', 'list']);
    for (const bad of ['update', 'delete', 'remove', 'clear', 'upsert', 'set']) {
      expect((repo as unknown as Record<string, unknown>)[bad]).toBeUndefined();
    }
  });

  it('appending the same id twice keeps both entries (history is never rewritten)', async () => {
    const repo = new InMemoryLineageRepository();
    await repo.append([rec({ data: { v: 1 } })]);
    await repo.append([rec({ data: { v: 2 } })]);
    const all = await repo.list('t1');
    expect(all).toHaveLength(2);
    expect(all.map((r) => r.data['v']).sort()).toEqual([1, 2]);
  });

  it('deep-copies on append: mutating the appended object does not alter history', async () => {
    const repo = new InMemoryLineageRepository();
    const original = rec({ data: { nested: { n: 1 } } });
    await repo.append([original]);
    (original.data['nested'] as { n: number }).n = 99;
    original.runId = 'mutated';
    const [stored] = await repo.list('t1');
    expect(stored?.data).toEqual({ nested: { n: 1 } });
    expect(stored?.runId).toBe('run_1');
  });

  it('deep-copies on list: mutating a returned record does not alter history', async () => {
    const repo = new InMemoryLineageRepository();
    await repo.append([rec({ data: { nested: { n: 1 } } })]);
    const [first] = await repo.list('t1');
    (first!.data['nested'] as { n: number }).n = 99;
    (first as { runId: string }).runId = 'mutated';
    const [second] = await repo.list('t1');
    expect(second?.data).toEqual({ nested: { n: 1 } });
    expect(second?.runId).toBe('run_1');
    expect(second).not.toBe(first);
    // Control: an untouched fresh copy is equal to the first pristine read.
    expect(second).toEqual(rec({ data: { nested: { n: 1 } } }));
  });

  it('does not retain the appended array or reflect later mutation of the input list', async () => {
    const repo = new InMemoryLineageRepository();
    const batch = [rec({ id: 'x' })];
    await repo.append(batch);
    batch.push(rec({ id: 'y' }));
    batch.length = 0;
    expect(await ids(repo, 't1')).toEqual(['x']);
  });

  it('ordering is independent of insertion order (control: reversed insert, same result)', async () => {
    const mk = (id: string, seq: number) => rec({ id, seq });
    const fwd = new InMemoryLineageRepository();
    const rev = new InMemoryLineageRepository();
    await fwd.append([mk('a', 1), mk('b', 2), mk('c', 3)]);
    await rev.append([mk('c', 3), mk('b', 2), mk('a', 1)]);
    expect(await ids(fwd, 't1')).toEqual(['a', 'b', 'c']);
    expect(await ids(rev, 't1')).toEqual(['a', 'b', 'c']);
  });

  it('scopes by tenant', async () => {
    const repo = new InMemoryLineageRepository();
    await repo.append([rec({ id: 'a' }), rec({ id: 'b', tenantId: 't2' })]);
    expect(await ids(repo, 't1')).toEqual(['a']);
    expect(await ids(repo, 't2')).toEqual(['b']);
    expect(await ids(repo, 't3')).toEqual([]);
    // Even a matching subject/run filter never crosses tenants.
    expect(await ids(repo, 't3', { runId: 'run_1' })).toEqual([]);
    // Positive control: the same run filter does return the record for its own tenant.
    expect(await ids(repo, 't1', { runId: 'run_1' })).toEqual(['a']);
    expect(await ids(repo, 't2', { runId: 'run_1' })).toEqual(['b']);
  });

  it('filters by workspace; records without workspace only appear without the filter', async () => {
    const repo = new InMemoryLineageRepository();
    const noWs = rec({ id: 'nows' });
    delete noWs.workspaceId;
    await repo.append([rec({ id: 'w1a' }), rec({ id: 'w2a', workspaceId: 'w2' }), noWs]);
    expect((await ids(repo, 't1')).sort()).toEqual(['nows', 'w1a', 'w2a']);
    expect(await ids(repo, 't1', { workspaceId: 'w1' })).toEqual(['w1a']);
    expect(await ids(repo, 't1', { workspaceId: 'w2' })).toEqual(['w2a']);
    expect(await ids(repo, 't1', { workspaceId: 'w9' })).toEqual([]);
  });

  it('filters by kind, subjectType, subjectId, runId, approvalId, invocationId', async () => {
    const repo = new InMemoryLineageRepository();
    await repo.append([
      rec({ id: 'base', seq: 0 }),
      rec({
        id: 'full',
        seq: 1,
        kind: 'EXECUTION',
        subjectType: 'tool',
        subjectId: 'S1',
        runId: 'run_2',
        approvalId: 'apr_1',
        invocationId: 'inv_1',
      }),
    ]);
    expect((await ids(repo, 't1')).sort()).toEqual(['base', 'full']);
    const cases: Array<Parameters<InMemoryLineageRepository['list']>[1]> = [
      { kind: 'EXECUTION' },
      { subjectType: 'tool' },
      { subjectId: 'S1' },
      { runId: 'run_2' },
      { approvalId: 'apr_1' },
      { invocationId: 'inv_1' },
    ];
    for (const q of cases) expect(await ids(repo, 't1', q)).toEqual(['full']);
    expect(await ids(repo, 't1', { kind: 'EVIDENCE' })).toEqual(['base']);
    expect(await ids(repo, 't1', { runId: 'run_1' })).toEqual(['base']);
    for (const q of [
      { subjectType: 'nope' },
      { subjectId: 'nope' },
      { approvalId: 'nope' },
      { invocationId: 'nope' },
    ]) {
      expect(await ids(repo, 't1', q)).toEqual([]);
    }
    // Combined filters are ANDed.
    expect(await ids(repo, 't1', { kind: 'EXECUTION', runId: 'run_2' })).toEqual(['full']);
    expect(await ids(repo, 't1', { kind: 'EVIDENCE', runId: 'run_2' })).toEqual([]);
  });

  it('orders by occurredAt, then seq, then id', async () => {
    const repo = new InMemoryLineageRepository();
    await repo.append([
      rec({ id: 'e', occurredAt: '2026-01-02T00:00:00.000Z', seq: 0 }),
      rec({ id: 'd', occurredAt: '2026-01-01T00:00:00.000Z', seq: 2 }),
      rec({ id: 'c', occurredAt: '2026-01-01T00:00:00.000Z', seq: 1 }),
      rec({ id: 'b', occurredAt: '2026-01-01T00:00:00.000Z', seq: 1 }),
      rec({ id: 'a', occurredAt: '2025-12-31T00:00:00.000Z', seq: 9 }),
    ]);
    expect(await ids(repo, 't1')).toEqual(['a', 'b', 'c', 'd', 'e']);
  });

  it('applies limit after ordering (control: no limit returns all)', async () => {
    const repo = new InMemoryLineageRepository();
    await repo.append([
      rec({ id: 'c', seq: 3 }),
      rec({ id: 'a', seq: 1 }),
      rec({ id: 'b', seq: 2 }),
    ]);
    expect(await ids(repo, 't1')).toEqual(['a', 'b', 'c']);
    expect(await ids(repo, 't1', { limit: 2 })).toEqual(['a', 'b']);
    expect(await ids(repo, 't1', { limit: 0 })).toEqual([]);
    expect(await ids(repo, 't1', { limit: 10 })).toEqual(['a', 'b', 'c']);
  });
});

describe('Prompt 9 contracts: verification source + approver attribution', () => {
  it('VerificationData carries source, limitation and per-rule checks, keeping `method` for compat', async () => {
    const data: VerificationData = {
      of: 'inv_1',
      verified: true,
      method: 'handler_result',
      source: 'handler_result',
      limitation: 'the tool reported success; no independent state read-back',
      checks: [{ ruleId: 'result.successful', passed: true }],
    };
    const repo = new InMemoryLineageRepository();
    await repo.append([
      rec({ id: 'lin_v', kind: 'VERIFICATION', invocationId: 'inv_1', data: { ...data } }),
    ]);
    const [stored] = await repo.list('t1', { kind: 'VERIFICATION' });
    expect(stored?.data).toMatchObject({ method: 'handler_result', source: 'handler_result' });
    expect(stored?.data['checks']).toEqual([{ ruleId: 'result.successful', passed: true }]);
  });

  it('every declared source is a valid VerificationData.source', () => {
    const sources: VerificationData['source'][] = [
      'state_readback',
      'provider_readback',
      'response_shape',
      'handler_result',
      'redetection',
    ];
    expect(new Set(sources).size).toBe(5);
  });

  it('approvedBy is descriptive data on PLANNED/EXECUTION records; the actor stays the requester', async () => {
    const approvedBy: ApprovedBy = {
      userId: 'usr_approver',
      roleId: 'rol_finance_manager',
      decidedAt: '2026-01-01T00:00:00.000Z',
    };
    const planned: PlannedActionData = {
      capabilityId: 'c',
      toolId: 't',
      stepId: 's',
      inputFingerprint: 'f',
      requiresApproval: true,
      approvedBy,
    };
    const execution: ExecutionData = {
      capabilityId: 'c',
      toolId: 't',
      origin: 'approval',
      status: 'succeeded',
      attempts: 1,
      completedAt: '2026-01-01T00:00:01.000Z',
      inputFingerprint: 'f',
      approvedBy,
    };
    const repo = new InMemoryLineageRepository();
    await repo.append([
      rec({ id: 'lin_p', kind: 'PLANNED_ACTION', actorId: 'usr_requester', data: { ...planned } }),
      rec({ id: 'lin_e', kind: 'EXECUTION', actorId: 'usr_requester', data: { ...execution } }),
    ]);
    for (const record of await repo.list('t1')) {
      expect(record.actorId).toBe('usr_requester');
      expect(record.data['approvedBy']).toEqual(approvedBy);
    }
  });
});
