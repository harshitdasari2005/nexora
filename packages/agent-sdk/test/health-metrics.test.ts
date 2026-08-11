/**
 * Health and metrics tests.
 */

import { describe, expect, it } from 'vitest';

import { runHealthChecks } from '../src/health/index.js';
import { InMemoryMetricsRecorder, NoopMetricsRecorder } from '../src/metrics/index.js';

describe('runHealthChecks', () => {
  it('reports healthy when all checks pass', async () => {
    const snapshot = await runHealthChecks(
      [
        { id: 'a', check: () => true },
        { id: 'b', check: async () => true },
      ],
      '2026-08-08T00:00:00.000Z',
    );
    expect(snapshot.status).toBe('healthy');
    expect(snapshot.checks).toHaveLength(2);
    expect(snapshot.takenAt).toBe('2026-08-08T00:00:00.000Z');
  });

  it('reports unavailable when all checks fail', async () => {
    const snapshot = await runHealthChecks(
      [
        { id: 'a', check: () => false },
        { id: 'b', check: async () => false },
      ],
      't',
    );
    expect(snapshot.status).toBe('unavailable');
  });

  it('reports degraded when some checks fail', async () => {
    const snapshot = await runHealthChecks(
      [
        { id: 'a', check: () => true },
        { id: 'b', check: () => false },
      ],
      't',
    );
    expect(snapshot.status).toBe('degraded');
  });

  it('captures thrown error messages as detail', async () => {
    const snapshot = await runHealthChecks(
      [{ id: 'a', check: () => Promise.reject(new Error('disk full')) }],
      't',
    );
    expect(snapshot.checks[0]?.healthy).toBe(false);
    expect(snapshot.checks[0]?.detail).toBe('disk full');
  });

  it('handles an empty check list as healthy', async () => {
    const snapshot = await runHealthChecks([], 't');
    expect(snapshot.status).toBe('healthy');
  });
});

describe('InMemoryMetricsRecorder', () => {
  it('accumulates execution counters', () => {
    const recorder = new InMemoryMetricsRecorder();
    recorder.recordExecution({ executionsStarted: 1, executionsSucceeded: 1, executionsFailed: 0 });
    recorder.recordExecution({ executionsStarted: 1, executionsSucceeded: 0, executionsFailed: 1 });
    expect(recorder.executions.executionsStarted).toBe(2);
    expect(recorder.executions.executionsSucceeded).toBe(1);
    expect(recorder.executions.executionsFailed).toBe(1);
  });

  it('computes latency statistics', () => {
    const recorder = new InMemoryMetricsRecorder();
    recorder.recordLatency(100);
    recorder.recordLatency(300);
    expect(recorder.latency.sampleCount).toBe(2);
    expect(recorder.latency.totalLatencyMs).toBe(400);
    expect(recorder.latency.averageLatencyMs).toBe(200);
  });

  it('returns zero latency stats before any sample', () => {
    const recorder = new InMemoryMetricsRecorder();
    expect(recorder.latency.averageLatencyMs).toBe(0);
    expect(recorder.latency.sampleCount).toBe(0);
  });

  it('accumulates usage counters', () => {
    const recorder = new InMemoryMetricsRecorder();
    recorder.recordUsage({ toolInvocations: 2, knowledgeRetrievals: 1, approvalsRequested: 0 });
    recorder.recordUsage({ toolInvocations: 1, knowledgeRetrievals: 0, approvalsRequested: 1 });
    expect(recorder.usage.toolInvocations).toBe(3);
    expect(recorder.usage.knowledgeRetrievals).toBe(1);
    expect(recorder.usage.approvalsRequested).toBe(1);
  });

  it('accumulates token and cost metrics', () => {
    const recorder = new InMemoryMetricsRecorder();
    recorder.recordTokens({ promptTokens: 10, completionTokens: 5 });
    recorder.recordTokens({ promptTokens: 10, completionTokens: 5 });
    expect(recorder.tokens.promptTokens).toBe(20);
    expect(recorder.tokens.completionTokens).toBe(10);
    recorder.recordCost({ cost: 1.5 });
    recorder.recordCost({ cost: 0.5 });
    expect(recorder.cost.cost).toBe(2);
  });
});

describe('NoopMetricsRecorder', () => {
  it('accepts all recording calls without throwing', () => {
    const recorder = new NoopMetricsRecorder();
    recorder.recordExecution({ executionsStarted: 1, executionsSucceeded: 1, executionsFailed: 0 });
    recorder.recordLatency(10);
    recorder.recordUsage({ toolInvocations: 1, knowledgeRetrievals: 1, approvalsRequested: 1 });
    recorder.recordTokens({ promptTokens: 1, completionTokens: 1 });
    recorder.recordCost({ cost: 0.1 });
  });
});
