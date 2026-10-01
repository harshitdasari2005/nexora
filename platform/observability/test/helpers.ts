import type { ModelCall, RunClock, RuntimeRun, ToolCall } from '../src/index.js';

export function makeRun(over: Partial<RuntimeRun> = {}): RuntimeRun {
  return {
    id: 'run_1',
    tenantId: 't1',
    actorId: 'u1',
    origin: 'chat',
    startedAt: '2026-01-01T00:00:00.000Z',
    endedAt: '2026-01-01T00:00:01.000Z',
    durationMs: 100,
    status: 'completed',
    stages: [],
    models: [],
    tools: [],
    retrievals: [],
    policies: [],
    tokenUsage: { available: false, promptTokens: 0, completionTokens: 0, totalTokens: 0 },
    cost: { estimated: null },
    schemaVersion: 1,
    ...over,
  };
}

export function makeModel(over: Partial<ModelCall> = {}): ModelCall {
  return {
    callId: 'mdl_1',
    purpose: 'narration',
    provider: 'groq',
    model: 'llama',
    execution: 'cloud',
    startOffsetMs: 0,
    durationMs: 10,
    status: 'succeeded',
    retries: 0,
    usageAvailable: false,
    cost: null,
    ...over,
  };
}

export function makeTool(over: Partial<ToolCall> = {}): ToolCall {
  return {
    invocationId: 'inv_1',
    toolId: 'crm.update',
    origin: 'orchestrator',
    startOffsetMs: 0,
    durationMs: 10,
    status: 'succeeded',
    attempts: 1,
    retries: [],
    verified: true,
    verificationMs: 0,
    ...over,
  };
}

/** A deterministic, manually advanced clock. */
export function fakeClock(start = 1000): RunClock & { t: number; advance(ms: number): void } {
  const clock = {
    t: start,
    nowMs: () => clock.t,
    nowIso: () => '2026-01-01T00:00:00.000Z',
    advance: (ms: number) => {
      clock.t += ms;
    },
  };
  return clock;
}
