import { describe, expect, it } from 'vitest';
import { bottleneckOf, percentile, summarize, type RuntimeRun } from '../src/index.js';
import { makeModel, makeRun, makeTool } from './helpers.js';

describe('percentile', () => {
  it('is null for empty samples', () => {
    expect(percentile([], 50)).toBeNull();
  });
  it('uses nearest-rank over actual samples', () => {
    const s = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100];
    expect(percentile(s, 50)).toBe(50);
    expect(percentile(s, 95)).toBe(100);
    expect(percentile(s, 99)).toBe(100);
    expect(percentile(s, 10)).toBe(10);
    expect(percentile(s, 0)).toBe(10);
    expect(percentile([7], 99)).toBe(7);
    expect(percentile([1, 2, 3, 4], 75)).toBe(3);
  });
  it('only returns values that exist in the sample', () => {
    const s = [1, 100];
    expect(s).toContain(percentile(s, 50));
  });
});

describe('summarize', () => {
  it('handles no runs', () => {
    const s = summarize([]);
    expect(s.runs).toBe(0);
    expect(s.failureRate).toBe(0);
    expect(s.latencyMs).toEqual({ avg: null, p50: null, p95: null, p99: null });
    expect(s.cost).toEqual({ estimated: null });
    expect(s.tokens).toEqual({ total: 0, runsWithUsage: 0 });
    expect(s.approvals).toEqual({
      opened: 0,
      resumed: 0,
      rejected: 0,
      expired: 0,
      notBound: 0,
      avgWaitMs: null,
      p95WaitMs: null,
    });
    expect(s.byFailureCode).toEqual({});
  });

  it('counts statuses, rates and latency percentiles', () => {
    const runs = [
      makeRun({ id: 'a', durationMs: 10 }),
      makeRun({ id: 'b', durationMs: 20 }),
      makeRun({ id: 'c', durationMs: 30, status: 'blocked' }),
      makeRun({ id: 'd', durationMs: 40, status: 'clarification' }),
      makeRun({ id: 'e', durationMs: 1000, status: 'failed' }),
    ];
    const s = summarize(runs);
    expect(s).toMatchObject({ runs: 5, completed: 2, failed: 1, blocked: 1, clarification: 1 });
    expect(s.failureRate).toBe(0.2);
    expect(s.latencyMs).toEqual({ avg: 220, p50: 30, p95: 1000, p99: 1000 });
  });

  it('counts denials separately from failures', () => {
    const denied = makeRun({
      id: 'x',
      status: 'blocked',
      failure: { stage: 'POLICY', code: 'POLICY_DENIED', class: 'DENIED' },
      policies: [{ policyId: 'p', version: '1', outcome: 'DENY', phase: 'execute', durationMs: 1 }],
    });
    const failed = makeRun({
      id: 'y',
      status: 'failed',
      failure: { stage: 'EXECUTION', code: 'TOOL_EXECUTION_FAILED', class: 'EXECUTION' },
      policies: [
        { policyId: 'p', version: '1', outcome: 'ALLOW', phase: 'execute', durationMs: 1 },
      ],
    });
    const s = summarize([denied, failed]);
    expect(s.denied).toBe(1);
    expect(s.failed).toBe(1);
    expect(s.policyDenials).toBe(1);
    expect(s.failureRate).toBe(0.5);
  });

  it('computes stage stats over actual samples', () => {
    const runs = [1, 2, 3, 4].map((n) =>
      makeRun({ id: `r${n}`, stages: [{ stage: 'EXECUTION', durationMs: n * 10, count: 1 }] }),
    );
    const s = summarize(runs);
    expect(s.stageMs.EXECUTION).toEqual({ avg: 25, p95: 40, runs: 4 });
    expect(s.stageMs.POLICY).toBeUndefined();
  });

  it('counts tool failures (anything not succeeded)', () => {
    const s = summarize([
      makeRun({
        tools: [
          makeTool({ invocationId: 'i1' }),
          makeTool({ invocationId: 'i2', status: 'failed' }),
          makeTool({ invocationId: 'i3', status: 'unverified' }),
          makeTool({ invocationId: 'i4' }),
        ],
      }),
    ]);
    expect(s.tools).toEqual({ calls: 4, failed: 2, failureRate: 0.5 });
  });

  it('sums tokens only over runs with usage', () => {
    const s = summarize([
      makeRun({
        id: 'a',
        tokenUsage: { available: true, promptTokens: 1, completionTokens: 2, totalTokens: 3 },
      }),
      makeRun({
        id: 'b',
        tokenUsage: { available: false, promptTokens: 50, completionTokens: 50, totalTokens: 100 },
      }),
      makeRun({
        id: 'c',
        tokenUsage: { available: true, promptTokens: 4, completionTokens: 4, totalTokens: 8 },
      }),
    ]);
    expect(s.tokens).toEqual({ total: 11, runsWithUsage: 2 });
  });

  it('cost is null with no priced run, and sums with currency otherwise', () => {
    expect(summarize([makeRun(), makeRun({ id: 'b' })]).cost).toEqual({ estimated: null });
    const s = summarize([
      makeRun({ id: 'a', cost: { estimated: 0.1, currency: 'USD' } }),
      makeRun({ id: 'b', cost: { estimated: null } }),
      makeRun({ id: 'c', cost: { estimated: 0.2, currency: 'USD' } }),
    ]);
    expect(s.cost).toEqual({ estimated: 0.3, currency: 'USD' });
  });

  it('compares models without ranking them', () => {
    const s = summarize([
      makeRun({
        id: 'a',
        models: [
          makeModel({
            callId: 'm1',
            durationMs: 100,
            usageAvailable: true,
            totalTokens: 30,
            cost: 0.5,
          }),
          makeModel({
            callId: 'm2',
            durationMs: 300,
            status: 'failed',
            errorCode: 'MODEL_ERROR',
            usageAvailable: false,
            totalTokens: 999,
          }),
          makeModel({
            callId: 'm3',
            provider: 'ollama',
            model: 'qwen',
            execution: 'local',
            durationMs: 50,
          }),
        ],
      }),
    ]);
    expect(s.models).toMatchObject({ calls: 3, failed: 1, failureRate: 0.3333 });
    const [groq, ollama] = s.models.byModel;
    expect(groq).toEqual({
      provider: 'groq',
      model: 'llama',
      execution: 'cloud',
      calls: 2,
      failures: 1,
      failureRate: 0.5,
      avgLatencyMs: 200,
      tokens: 30,
      callsWithUsage: 1,
      cost: 0.5,
    });
    expect(ollama).toMatchObject({ provider: 'ollama', calls: 1, cost: null, tokens: 0 });
    for (const stat of s.models.byModel) {
      expect(stat).not.toHaveProperty('rank');
      expect(stat).not.toHaveProperty('best');
      expect(stat).not.toHaveProperty('score');
    }
    expect(s.models).not.toHaveProperty('best');
  });

  it('computes approval wait and verification stats', () => {
    const s = summarize([
      makeRun({ id: 'a', approval: { approvalId: 'ap1', state: 'resumed', waitMs: 100 } }),
      makeRun({ id: 'b', approval: { approvalId: 'ap2', state: 'resumed', waitMs: 300 } }),
      makeRun({ id: 'c', approval: { approvalId: 'ap3', state: 'opened' } }),
      makeRun({ id: 'd', verified: true }),
      makeRun({ id: 'e', verified: false }),
      makeRun({ id: 'f', verified: false }),
    ]);
    expect(s.approvals).toEqual({
      opened: 1,
      resumed: 2,
      rejected: 0,
      expired: 0,
      notBound: 0,
      avgWaitMs: 200,
      p95WaitMs: 300,
    });
    expect(s.verification).toEqual({ runsVerified: 1, runsUnverified: 2, failureRate: 0.6667 });
  });
});

describe('summarize — approval governance counts', () => {
  const failure = (
    code: 'APPROVAL_EXPIRED' | 'APPROVAL_NOT_BOUND' | 'POLICY_DENIED' | 'TOOL_TIMEOUT',
  ): RuntimeRun['failure'] =>
    ({
      APPROVAL_EXPIRED: { stage: 'APPROVAL', code, class: 'APPROVAL' },
      APPROVAL_NOT_BOUND: { stage: 'APPROVAL', code, class: 'APPROVAL' },
      POLICY_DENIED: { stage: 'POLICY', code, class: 'DENIED' },
      TOOL_TIMEOUT: { stage: 'EXECUTION', code, class: 'TIMEOUT' },
    })[code] as RuntimeRun['failure'];

  it('counts opened / resumed / rejected / expired and failures by code', () => {
    const s = summarize([
      makeRun({ id: 'a', status: 'blocked', approval: { approvalId: 'p1', state: 'opened' } }),
      makeRun({
        id: 'b',
        approval: { approvalId: 'p2', state: 'resumed', decision: 'grant', waitMs: 10 },
      }),
      makeRun({
        id: 'c',
        status: 'blocked',
        approval: { approvalId: 'p3', state: 'resumed', decision: 'reject', waitMs: 20 },
      }),
      makeRun({
        id: 'd',
        status: 'failed',
        approval: { approvalId: 'p4', state: 'expired' },
        failure: failure('APPROVAL_EXPIRED'),
      }),
      // Expired via failure code alone (no approval timing recorded).
      makeRun({ id: 'e', status: 'failed', failure: failure('APPROVAL_EXPIRED') }),
      makeRun({ id: 'f', status: 'failed', failure: failure('POLICY_DENIED') }),
      makeRun({ id: 'g', status: 'failed', failure: failure('TOOL_TIMEOUT') }),
      makeRun({ id: 'h' }),
      makeRun({ id: 'i', status: 'failed', failure: failure('APPROVAL_NOT_BOUND') }),
    ]);
    expect(s.approvals).toMatchObject({
      opened: 1,
      resumed: 2,
      rejected: 1,
      expired: 2,
      notBound: 1,
    });
    expect(s.byFailureCode).toEqual({
      APPROVAL_EXPIRED: 2,
      APPROVAL_NOT_BOUND: 1,
      POLICY_DENIED: 1,
      TOOL_TIMEOUT: 1,
    });
    // An expired approval is an approval outcome, not a policy denial.
    expect(s.denied).toBe(1);
  });
});

describe('bottleneckOf', () => {
  it('is empty for a run with nothing recorded', () => {
    expect(bottleneckOf(makeRun())).toEqual({});
  });

  it('picks the slowest stage, tool and model from actual timings with share math', () => {
    const run = makeRun({
      durationMs: 200,
      stages: [
        { stage: 'POLICY', durationMs: 20, count: 1 },
        { stage: 'EXECUTION', durationMs: 50, count: 3 },
        { stage: 'NARRATION', durationMs: 30, count: 1 },
      ],
      tools: [
        makeTool({ invocationId: 'i1', toolId: 'a.b', durationMs: 10 }),
        makeTool({ invocationId: 'i2', toolId: 'c.d', durationMs: 40 }),
      ],
      models: [
        makeModel({ callId: 'm1', durationMs: 5 }),
        makeModel({ callId: 'm2', provider: 'ollama', durationMs: 25 }),
      ],
    });
    expect(bottleneckOf(run)).toEqual({
      stage: { stage: 'EXECUTION', durationMs: 50, share: 0.25 },
      tool: { invocationId: 'i2', toolId: 'c.d', durationMs: 40, share: 0.2 },
      model: { callId: 'm2', provider: 'ollama', durationMs: 25, share: 0.125 },
    });
  });

  it('does not divide by zero for a zero-duration run', () => {
    const b = bottleneckOf(makeRun({ durationMs: 0, tools: [makeTool({ durationMs: 5 })] }));
    // The share is clamped: a slice can never exceed the whole.
    expect(b.tool?.share).toBe(1);
  });
});
