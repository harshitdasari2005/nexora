import type { RuntimeRun, RuntimeStage } from './contracts.js';

/** The nearest-rank percentile of an ascending-sorted sample (`p` in 0..100). */
export function percentile(sortedAscending: readonly number[], p: number): number | null {
  if (sortedAscending.length === 0) {
    return null;
  }
  const rank = Math.max(1, Math.ceil((p / 100) * sortedAscending.length));
  return sortedAscending[Math.min(rank, sortedAscending.length) - 1] as number;
}

/** Per provider/model statistics — comparison, never ranking. */
export interface ModelStats {
  provider: string;
  model: string;
  execution: 'local' | 'cloud' | 'unknown';
  calls: number;
  failures: number;
  failureRate: number;
  avgLatencyMs: number | null;
  /** Tokens over calls that REPORTED usage only. */
  tokens: number;
  callsWithUsage: number;
  /** Sum of estimated cost over priced calls; `null` when no call was priced. */
  cost: number | null;
}

/** Aggregate runtime metrics over a set of runs the caller is authorized to see. */
export interface RuntimeSummary {
  runs: number;
  completed: number;
  failed: number;
  blocked: number;
  clarification: number;
  /** failed / runs. Denials are counted under `denied`, not as failures of the system. */
  failureRate: number;
  denied: number;
  latencyMs: { avg: number | null; p50: number | null; p95: number | null; p99: number | null };
  stageMs: Partial<Record<RuntimeStage, { avg: number; p95: number; runs: number }>>;
  tools: { calls: number; failed: number; failureRate: number };
  models: { calls: number; failed: number; failureRate: number; byModel: readonly ModelStats[] };
  policyDenials: number;
  /**
   * `opened`/`resumed`/`expired` count runs by their approval timing state;
   * `rejected` counts approval runs whose recorded decision was a rejection;
   * `expired` also counts runs failed with APPROVAL_EXPIRED. Counts only —
   * never prompts or payloads.
   */
  approvals: {
    opened: number;
    resumed: number;
    rejected: number;
    expired: number;
    /** Runs failed with APPROVAL_NOT_BOUND (a resumed approval no step consumed). */
    notBound: number;
    avgWaitMs: number | null;
    p95WaitMs: number | null;
  };
  /** Failed runs by taxonomy code (e.g. `APPROVAL_EXPIRED`, `POLICY_DENIED`). */
  byFailureCode: Record<string, number>;
  verification: { runsVerified: number; runsUnverified: number; failureRate: number };
  tokens: { total: number; runsWithUsage: number };
  cost: { estimated: number | null; currency?: string };
}

const rate = (part: number, whole: number): number =>
  whole === 0 ? 0 : Math.round((part / whole) * 10000) / 10000;
const avg = (values: readonly number[]): number | null =>
  values.length === 0
    ? null
    : Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 100) / 100;

/**
 * Summarizes runs. Pure and deterministic: percentiles are nearest-rank over
 * the ACTUAL samples (never derived from averages). The caller supplies only
 * runs it is authorized to see; the window and tenant scope are the caller's.
 */
export function summarize(runs: readonly RuntimeRun[]): RuntimeSummary {
  const durations = runs.map((r) => r.durationMs).sort((a, b) => a - b);
  const stageSamples = new Map<RuntimeStage, number[]>();
  for (const run of runs) {
    for (const stage of run.stages) {
      const samples = stageSamples.get(stage.stage);
      if (samples === undefined) stageSamples.set(stage.stage, [stage.durationMs]);
      else samples.push(stage.durationMs);
    }
  }
  const stageMs: RuntimeSummary['stageMs'] = {};
  for (const [stage, samples] of stageSamples) {
    const sorted = [...samples].sort((a, b) => a - b);
    stageMs[stage] = {
      avg: avg(sorted) as number,
      p95: percentile(sorted, 95) as number,
      runs: sorted.length,
    };
  }
  const toolCalls = runs.flatMap((r) => r.tools);
  const modelCalls = runs.flatMap((r) => r.models);
  const byModel = new Map<string, ModelStats>();
  for (const call of modelCalls) {
    const key = `${call.provider}/${call.model ?? 'unknown'}`;
    const current =
      byModel.get(key) ??
      ({
        provider: call.provider,
        model: call.model ?? 'unknown',
        execution: call.execution,
        calls: 0,
        failures: 0,
        failureRate: 0,
        avgLatencyMs: null,
        tokens: 0,
        callsWithUsage: 0,
        cost: null,
      } satisfies ModelStats);
    byModel.set(key, {
      ...current,
      calls: current.calls + 1,
      failures: current.failures + (call.status === 'failed' ? 1 : 0),
      tokens: current.tokens + (call.usageAvailable ? (call.totalTokens ?? 0) : 0),
      callsWithUsage: current.callsWithUsage + (call.usageAvailable ? 1 : 0),
      cost: call.cost === null ? current.cost : (current.cost ?? 0) + call.cost,
    });
  }
  const modelStats = [...byModel.values()]
    .map((stat) => {
      const latencies = modelCalls
        .filter((c) => `${c.provider}/${c.model ?? 'unknown'}` === `${stat.provider}/${stat.model}`)
        .map((c) => c.durationMs);
      return {
        ...stat,
        failureRate: rate(stat.failures, stat.calls),
        avgLatencyMs: avg(latencies),
      };
    })
    .sort((a, b) => (a.provider + a.model).localeCompare(b.provider + b.model));
  const waits = runs
    .map((r) => r.approval?.waitMs)
    .filter((w): w is number => w !== undefined)
    .sort((a, b) => a - b);
  const executed = runs.filter((r) => r.verified !== undefined);
  const costs = runs.map((r) => r.cost.estimated).filter((c): c is number => c !== null);
  const currency = runs.find((r) => r.cost.currency !== undefined)?.cost.currency;
  const byFailureCode: Record<string, number> = {};
  for (const run of runs) {
    if (run.failure !== undefined) {
      byFailureCode[run.failure.code] = (byFailureCode[run.failure.code] ?? 0) + 1;
    }
  }
  const failed = runs.filter((r) => r.status === 'failed').length;
  const denied = runs.filter((r) => r.failure?.class === 'DENIED').length;
  return {
    runs: runs.length,
    completed: runs.filter((r) => r.status === 'completed').length,
    failed,
    blocked: runs.filter((r) => r.status === 'blocked').length,
    clarification: runs.filter((r) => r.status === 'clarification').length,
    failureRate: rate(failed, runs.length),
    denied,
    latencyMs: {
      avg: avg(durations),
      p50: percentile(durations, 50),
      p95: percentile(durations, 95),
      p99: percentile(durations, 99),
    },
    stageMs,
    tools: {
      calls: toolCalls.length,
      failed: toolCalls.filter((t) => t.status !== 'succeeded').length,
      failureRate: rate(toolCalls.filter((t) => t.status !== 'succeeded').length, toolCalls.length),
    },
    models: {
      calls: modelCalls.length,
      failed: modelCalls.filter((c) => c.status === 'failed').length,
      failureRate: rate(modelCalls.filter((c) => c.status === 'failed').length, modelCalls.length),
      byModel: modelStats,
    },
    policyDenials: runs.flatMap((r) => r.policies).filter((p) => p.outcome === 'DENY').length,
    approvals: {
      opened: runs.filter((r) => r.approval?.state === 'opened').length,
      resumed: runs.filter((r) => r.approval?.state === 'resumed').length,
      rejected: runs.filter((r) => r.approval?.decision === 'reject').length,
      expired: runs.filter(
        (r) => r.approval?.state === 'expired' || r.failure?.code === 'APPROVAL_EXPIRED',
      ).length,
      notBound: runs.filter((r) => r.failure?.code === 'APPROVAL_NOT_BOUND').length,
      avgWaitMs: avg(waits),
      p95WaitMs: percentile(waits, 95),
    },
    byFailureCode,
    verification: {
      runsVerified: executed.filter((r) => r.verified === true).length,
      runsUnverified: executed.filter((r) => r.verified === false).length,
      failureRate: rate(executed.filter((r) => r.verified === false).length, executed.length),
    },
    tokens: {
      total: runs.reduce(
        (sum, r) => sum + (r.tokenUsage.available ? r.tokenUsage.totalTokens : 0),
        0,
      ),
      runsWithUsage: runs.filter((r) => r.tokenUsage.available).length,
    },
    cost: {
      estimated:
        costs.length === 0 ? null : Math.round(costs.reduce((a, b) => a + b, 0) * 1e8) / 1e8,
      ...(currency === undefined ? {} : { currency }),
    },
  };
}

/** The bottleneck of one run: the slowest tool call and the slowest stage, from ACTUAL timings. */
export function bottleneckOf(run: RuntimeRun): {
  stage?: { stage: RuntimeStage; durationMs: number; share: number };
  tool?: { invocationId: string; toolId: string; durationMs: number; share: number };
  model?: { callId: string; provider: string; durationMs: number; share: number };
} {
  const total = Math.max(run.durationMs, 1);
  const slowestStage = [...run.stages].sort((a, b) => b.durationMs - a.durationMs)[0];
  const slowestTool = [...run.tools].sort((a, b) => b.durationMs - a.durationMs)[0];
  const slowestModel = [...run.models].sort((a, b) => b.durationMs - a.durationMs)[0];
  const share = (ms: number): number => Math.min(1, Math.round((ms / total) * 10000) / 10000);
  return {
    ...(slowestStage === undefined
      ? {}
      : {
          stage: {
            stage: slowestStage.stage,
            durationMs: slowestStage.durationMs,
            share: share(slowestStage.durationMs),
          },
        }),
    ...(slowestTool === undefined
      ? {}
      : {
          tool: {
            invocationId: slowestTool.invocationId,
            toolId: slowestTool.toolId,
            durationMs: slowestTool.durationMs,
            share: share(slowestTool.durationMs),
          },
        }),
    ...(slowestModel === undefined
      ? {}
      : {
          model: {
            callId: slowestModel.callId,
            provider: slowestModel.provider,
            durationMs: slowestModel.durationMs,
            share: share(slowestModel.durationMs),
          },
        }),
  };
}
