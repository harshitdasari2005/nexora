/**
 * @nexora/ai-runtime — telemetry tests.
 */

import { describe, expect, it } from 'vitest';

import { InMemoryTelemetrySink } from '../src/telemetry/in-memory-sink.js';
import type { ExecutionTrace, TelemetryRecord } from '../src/telemetry/telemetry.js';
import { buildDecisionRecord } from '../src/orchestrator/decision.js';

describe('InMemoryTelemetrySink', () => {
  it('records and exposes records', () => {
    const sink = new InMemoryTelemetrySink();
    const trace: ExecutionTrace = {
      runId: 'run_1',
      stages: [],
      outcome: 'completed',
      startedAt: '2026-08-08T00:00:00.000Z',
    };
    sink.record({ kind: 'trace', trace });
    expect(sink.size).toBe(1);
    expect(sink.traces()[0]?.runId).toBe('run_1');
  });

  it('filters decisions and prompts', () => {
    const sink = new InMemoryTelemetrySink();
    const decision = buildDecisionRecord({
      runId: 'run_1',
      intent: 'do something',
      steps: [],
      approvals: [],
      outcome: 'failed',
      madeAt: '2026-08-08T00:00:00.000Z',
    });
    sink.record({ kind: 'decision', decision });
    sink.record({
      kind: 'prompt',
      prompt: { id: 'p1', servedAt: '2026-08-08T00:00:00.000Z' },
    });
    expect(sink.decisions()).toHaveLength(1);
    expect(sink.prompts()[0]?.id).toBe('p1');
  });

  it('accepts every record kind', () => {
    const sink = new InMemoryTelemetrySink();
    const records: TelemetryRecord[] = [
      { kind: 'trace', trace: { runId: 'r', stages: [], outcome: 'completed', startedAt: 'x' } },
      {
        kind: 'latency',
        latency: { stage: 'planning', durationMs: 5, at: 'x' },
      },
      { kind: 'cost', cost: { cost: 1, at: 'x' } },
    ];
    for (const record of records) {
      sink.record(record);
    }
    expect(sink.size).toBe(3);
  });

  it('all() returns copies', () => {
    const sink = new InMemoryTelemetrySink();
    const trace: ExecutionTrace = {
      runId: 'r',
      stages: [],
      outcome: 'completed',
      startedAt: 'x',
    };
    sink.record({ kind: 'trace', trace });
    const all = sink.all();
    expect(all).toHaveLength(1);
  });
});
