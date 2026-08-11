/**
 * @nexora/ai-runtime — trace builder.
 *
 * A mutable builder for the run's execution trace (AIR.md §16 Execution
 * Timeline). The orchestrator records stages at decision time; the finished
 * trace is emitted as a telemetry record.
 */

import type { ExecutionTrace, TraceStage } from '../telemetry/telemetry.js';

/** A stage recorder for one run. */
export interface TraceBuilder {
  /** Records a stage (idempotent by stage name: last wins). */
  stage(name: string, detail?: string): void;
  /** Marks the run finished with the given outcome. */
  complete(outcome: ExecutionTrace['outcome']): void;
  /** Produces the immutable trace record. */
  toRecord(): ExecutionTrace;
}

/** Builds a new trace builder for a run. */
export function buildExecutionTrace(runId: string, startedAt: string): TraceBuilder {
  const stages = new Map<string, TraceStage>();
  let outcome: ExecutionTrace['outcome'] = 'completed';
  let finishedAt: string | undefined;

  return {
    stage(name, detail) {
      const existing = stages.get(name);
      if (existing !== undefined) {
        stages.set(name, { ...existing, detail: detail ?? existing.detail });
        return;
      }
      stages.set(name, { stage: name, startedAt: nowIso(), status: 'succeeded', detail });
    },
    complete(finalOutcome) {
      outcome = finalOutcome;
      finishedAt = nowIso();
    },
    toRecord() {
      return {
        runId,
        stages: [...stages.values()],
        outcome,
        startedAt,
        finishedAt,
      };
    },
  };
}

function nowIso(): string {
  return new Date().toISOString();
}
