import { describe, expect, it } from 'vitest';
import {
  RunCollector,
  RunTelemetryHub,
  systemClock,
  type ModelPricing,
  type RunMeta,
  type RuntimeRun,
} from '../src/index.js';
import { fakeClock, makeModel, makeTool } from './helpers.js';

const meta: RunMeta = { runId: 'run_1', tenantId: 't1', actorId: 'u1', origin: 'chat' };
const pricing: ModelPricing = {
  version: 'v1',
  currency: 'USD',
  models: { 'groq/llama': { promptPer1k: 1, completionPer1k: 2 } },
};
const usage = {
  usageAvailable: true,
  promptTokens: 1000,
  completionTokens: 500,
  totalTokens: 1500,
};
const modelInput = (over = {}): Parameters<RunCollector['model']>[0] => {
  const call: Record<string, unknown> = { ...makeModel(over) };
  delete call.cost;
  delete call.currency;
  delete call.pricingVersion;
  return call as Parameters<RunCollector['model']>[0];
};

describe('RunCollector', () => {
  it('uses a deterministic injected clock for durations', () => {
    const clock = fakeClock();
    const c = new RunCollector(meta, { clock });
    clock.advance(123.456);
    expect(c.offset()).toBe(123.46);
    clock.advance(76.544);
    const run = c.finish('completed');
    expect(run.durationMs).toBe(200);
    expect(run.startedAt).toBe('2026-01-01T00:00:00.000Z');
    expect(run.schemaVersion).toBe(1);
    expect(run.id).toBe('run_1');
  });

  it('works with the system clock', () => {
    const run = new RunCollector(meta, { clock: systemClock }).finish('completed');
    expect(run.durationMs).toBeGreaterThanOrEqual(0);
    expect(new Date(run.startedAt).toISOString()).toBe(run.startedAt);
  });

  it('omits unused stages and optional fields', () => {
    const run = new RunCollector(meta, { clock: fakeClock() }).finish('completed');
    expect(run.stages).toEqual([]);
    expect(run.tools).toEqual([]);
    expect(run.models).toEqual([]);
    expect(run.approval).toBeUndefined();
    expect(run.verified).toBeUndefined();
    expect(run.provider).toBeUndefined();
    expect(run.failure).toBeUndefined();
    expect('requestId' in run).toBe(false);
    expect(run.tokenUsage).toEqual({
      available: false,
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
    });
    expect(run.cost).toEqual({ estimated: null });
  });

  it('copies optional meta and honours requested origin', () => {
    const c = new RunCollector(
      {
        ...meta,
        requestId: 'rq',
        correlationId: 'co',
        workspaceId: 'w',
        agentId: 'ag',
        delegationId: 'dg',
      },
      { clock: fakeClock() },
    );
    const run = c.finish('failed', undefined, 'mcp');
    expect(run).toMatchObject({
      requestId: 'rq',
      correlationId: 'co',
      workspaceId: 'w',
      agentId: 'ag',
      delegationId: 'dg',
      origin: 'mcp',
      status: 'failed',
    });
  });

  it('addStage sums, counts, and ignores negative/NaN/Infinity', () => {
    const c = new RunCollector(meta, { clock: fakeClock() });
    c.addStage('PLANNING', 10);
    c.addStage('PLANNING', 5.5);
    c.addStage('PLANNING', -1);
    c.addStage('PLANNING', Number.NaN);
    c.addStage('PLANNING', Number.POSITIVE_INFINITY);
    c.addStage('REQUEST', -5);
    const run = c.finish('completed');
    expect(run.stages).toEqual([{ stage: 'PLANNING', durationMs: 15.5, count: 2 }]);
  });

  it('addStage accepts zero', () => {
    const c = new RunCollector(meta, { clock: fakeClock() });
    c.addStage('REQUEST', 0);
    expect(c.finish('completed').stages).toEqual([{ stage: 'REQUEST', durationMs: 0, count: 1 }]);
  });

  it('time() records the stage and returns the value', async () => {
    const clock = fakeClock();
    const c = new RunCollector(meta, { clock });
    const value = await c.time('PLANNING', async () => {
      clock.advance(40);
      return 'ok';
    });
    expect(value).toBe('ok');
    expect(c.finish('completed').stages).toEqual([{ stage: 'PLANNING', durationMs: 40, count: 1 }]);
  });

  it('time() rethrows and still records', async () => {
    const clock = fakeClock();
    const c = new RunCollector(meta, { clock });
    await expect(
      c.time('NARRATION', () => {
        clock.advance(7);
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    expect(c.finish('failed').stages).toEqual([{ stage: 'NARRATION', durationMs: 7, count: 1 }]);
  });

  describe('model()', () => {
    it('computes cost only with pricing and usage', () => {
      const priced = new RunCollector(meta, { clock: fakeClock(), pricing });
      priced.model(modelInput(usage));
      priced.model(modelInput({ callId: 'm2' }));
      const run = priced.finish('completed');
      expect(run.models[0]).toMatchObject({ cost: 2, currency: 'USD', pricingVersion: 'v1' });
      expect(run.models[1]?.cost).toBeNull();
      expect(run.models[1]).not.toHaveProperty('currency');

      const unpriced = new RunCollector(meta, { clock: fakeClock() });
      unpriced.model(modelInput(usage));
      expect(unpriced.finish('completed').models[0]?.cost).toBeNull();
      expect(unpriced.pricing).toBeUndefined();
      expect(priced.pricing).toBe(pricing);
    });

    it('tokenUsage.available is true only if every call reported usage', () => {
      const all = new RunCollector(meta, { clock: fakeClock(), pricing });
      all.model(modelInput(usage));
      all.model(modelInput({ ...usage, callId: 'm2' }));
      const a = all.finish('completed');
      expect(a.tokenUsage).toEqual({
        available: true,
        promptTokens: 2000,
        completionTokens: 1000,
        totalTokens: 3000,
      });
      expect(a.cost).toEqual({ estimated: 4, currency: 'USD', pricingVersion: 'v1' });
      expect(a.provider).toBe('groq');
      expect(a.model).toBe('llama');
      expect(a.modelExecution).toBe('cloud');

      const some = new RunCollector(meta, { clock: fakeClock(), pricing });
      some.model(modelInput(usage));
      some.model(modelInput({ callId: 'm2', usageAvailable: false, promptTokens: 999 }));
      const s = some.finish('completed');
      expect(s.tokenUsage.available).toBe(false);
      expect(s.tokenUsage.promptTokens).toBe(1000); // unreported usage is never counted
      expect(s.cost.estimated).toBeNull(); // partial pricing is not reported as a total
      expect(s.cost).not.toHaveProperty('currency');
    });
  });

  it('policy() records the call and time in the POLICY stage', () => {
    const c = new RunCollector(meta, { clock: fakeClock() });
    c.policy({ policyId: 'p', version: '1', outcome: 'ALLOW', phase: 'execute', durationMs: 3 });
    const run = c.finish('completed');
    expect(run.policies).toHaveLength(1);
    expect(run.stages).toEqual([{ stage: 'POLICY', durationMs: 3, count: 1 }]);
  });

  it('keeps approval wait separate from run duration', () => {
    const clock = fakeClock();
    const c = new RunCollector(meta, { clock });
    clock.advance(50);
    c.approval({ approvalId: 'ap', state: 'resumed', waitMs: 3_600_000, decision: 'grant' });
    const run = c.finish('completed');
    expect(run.durationMs).toBe(50);
    expect(run.approval?.waitMs).toBe(3_600_000);
    expect(run.stages.some((s) => s.stage === 'APPROVAL')).toBe(false);
  });

  it('records who decided the approval (descriptive) without touching timing', () => {
    const c = new RunCollector(meta, { clock: fakeClock() });
    c.approval({
      approvalId: 'ap',
      state: 'resumed',
      decision: 'grant',
      decidedBy: 'usr_approver',
    });
    const run = c.finish('completed');
    expect(run.approval).toMatchObject({ decidedBy: 'usr_approver', state: 'resumed' });
    expect(run.actorId).toBe(meta.actorId);
  });

  describe('invocation()', () => {
    const segments = { authorizationMs: 2, policyMs: 3, executionMs: 40, verificationMs: 5 };

    it('attributes segments to their own stages without double counting', () => {
      const c = new RunCollector(meta, { clock: fakeClock() });
      c.invocation(segments, makeTool({ durationMs: 47 }));
      const stages = Object.fromEntries(
        c.finish('completed').stages.map((s) => [s.stage, s.durationMs]),
      );
      // policyMs is reported via policy(), so it is not added here.
      expect(stages).toEqual({ AUTHORIZATION: 2, EXECUTION: 40, VERIFICATION: 5 });
    });

    it('records only authorization for a refusal with no tool call', () => {
      const c = new RunCollector(meta, { clock: fakeClock() });
      c.invocation(segments);
      const run = c.finish('blocked');
      expect(run.stages).toEqual([{ stage: 'AUTHORIZATION', durationMs: 2, count: 1 }]);
      expect(run.tools).toEqual([]);
    });

    it('skips zero-length authorization and verification segments', () => {
      const c = new RunCollector(meta, { clock: fakeClock() });
      c.invocation({ ...segments, authorizationMs: 0, verificationMs: 0 }, makeTool());
      expect(c.finish('completed').stages.map((s) => s.stage)).toEqual(['EXECUTION']);
    });

    it.each([
      ['knowledge.search', 'knowledge'],
      ['documents.search', 'documents'],
    ])('creates a retrieval record for %s', (toolId, sourceType) => {
      const c = new RunCollector(meta, { clock: fakeClock() });
      c.invocation(segments, makeTool({ invocationId: 'inv_abc', toolId }), 7);
      c.invocation(segments, makeTool({ invocationId: 'inv_def', toolId, status: 'failed' }));
      const run = c.finish('completed');
      expect(run.retrievals).toEqual([
        {
          retrievalId: 'rtv_abc',
          invocationId: 'inv_abc',
          toolId,
          sourceType,
          resultCount: 7,
          durationMs: 40,
          status: 'succeeded',
        },
        expect.objectContaining({ retrievalId: 'rtv_def', resultCount: 0, status: 'failed' }),
      ]);
      const stageNames = run.stages.map((s) => s.stage);
      expect(stageNames).toContain('RETRIEVAL');
      expect(stageNames).not.toContain('EXECUTION');
    });

    it('creates no retrieval record for ordinary tools', () => {
      const c = new RunCollector(meta, { clock: fakeClock() });
      c.invocation(segments, makeTool());
      expect(c.finish('completed').retrievals).toEqual([]);
    });
  });

  it('noteError keeps the FIRST error', () => {
    const c = new RunCollector(meta, { clock: fakeClock() });
    expect(c.firstError).toBeUndefined();
    c.noteError('FORBIDDEN', 'a.b', 'inv_1');
    c.noteError('TIMEOUT', 'c.d', 'inv_2');
    expect(c.firstError).toEqual({ code: 'FORBIDDEN', toolId: 'a.b', invocationId: 'inv_1' });
  });

  it('finish() sorts tools by startOffsetMs and derives verified', () => {
    const c = new RunCollector(meta, { clock: fakeClock() });
    const seg = { authorizationMs: 0, policyMs: 0, executionMs: 1, verificationMs: 0 };
    c.invocation(seg, makeTool({ invocationId: 'inv_late', startOffsetMs: 30 }));
    c.invocation(seg, makeTool({ invocationId: 'inv_early', startOffsetMs: 5, verified: false }));
    c.invocation(seg, makeTool({ invocationId: 'inv_mid', startOffsetMs: 10 }));
    const run = c.finish('completed');
    expect(run.tools.map((t) => t.invocationId)).toEqual(['inv_early', 'inv_mid', 'inv_late']);
    expect(run.verified).toBe(false);
  });

  it('carries the supplied failure', () => {
    const failure = { stage: 'POLICY', code: 'POLICY_DENIED', class: 'DENIED' } as const;
    expect(
      new RunCollector(meta, { clock: fakeClock() }).finish('blocked', failure).failure,
    ).toEqual(failure);
  });
});

describe('RunTelemetryHub', () => {
  const metaFor = (runId: string): RunMeta => ({ ...meta, runId });

  it('begin/get/end lifecycle', async () => {
    const clock = fakeClock();
    const hub = new RunTelemetryHub({ clock });
    const c = hub.begin(metaFor('run_a'));
    expect(hub.get('run_a')).toBe(c);
    clock.advance(25);
    const run = await hub.end('run_a', 'completed');
    expect(run?.durationMs).toBe(25);
    expect(hub.get('run_a')).toBeUndefined();
    expect(await hub.end('run_a', 'completed')).toBeUndefined();
  });

  it('end of an unknown key returns undefined and does not call the sink', async () => {
    const seen: RuntimeRun[] = [];
    const hub = new RunTelemetryHub({ sink: (r) => void seen.push(r) });
    expect(await hub.end('nope', 'failed')).toBeUndefined();
    expect(seen).toEqual([]);
  });

  it('delivers the finished run to the sink (sync or async)', async () => {
    const seen: RuntimeRun[] = [];
    const hub = new RunTelemetryHub({
      sink: async (r) => {
        seen.push(r);
      },
    });
    hub.begin(metaFor('run_a'));
    const run = await hub.end('run_a', 'blocked', {
      stage: 'POLICY',
      code: 'POLICY_DENIED',
      class: 'DENIED',
    });
    expect(seen).toEqual([run]);
    expect(run?.status).toBe('blocked');
  });

  it('a throwing or rejecting sink never throws out of end()', async () => {
    const sync = new RunTelemetryHub({
      sink: () => {
        throw new Error('sink down');
      },
    });
    sync.begin(metaFor('run_a'));
    await expect(sync.end('run_a', 'completed')).resolves.toMatchObject({ id: 'run_a' });

    const async_ = new RunTelemetryHub({ sink: () => Promise.reject(new Error('sink down')) });
    async_.begin(metaFor('run_b'));
    await expect(async_.end('run_b', 'completed')).resolves.toMatchObject({ id: 'run_b' });
  });

  it('passes pricing to collectors', () => {
    const hub = new RunTelemetryHub({ pricing });
    expect(hub.begin(metaFor('run_p')).pricing).toBe(pricing);
  });

  it('bounds the registry at 10_000, evicting the oldest', () => {
    const hub = new RunTelemetryHub({ clock: fakeClock() });
    for (let i = 0; i < 10_000; i += 1) hub.begin(metaFor(`run_${i}`));
    expect(hub.get('run_0')).toBeDefined();
    hub.begin(metaFor('run_new'));
    expect(hub.get('run_0')).toBeUndefined();
    expect(hub.get('run_1')).toBeDefined();
    expect(hub.get('run_new')).toBeDefined();
    hub.begin(metaFor('run_new2'));
    expect(hub.get('run_1')).toBeUndefined();
  });
});
