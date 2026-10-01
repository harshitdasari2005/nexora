import type {
  ApprovalTiming,
  ModelCall,
  PolicyCall,
  RetrievalCall,
  RunFailure,
  RuntimeOrigin,
  RuntimeRun,
  RuntimeStage,
  RuntimeStatus,
  StageTiming,
  ToolCall,
} from './contracts.js';
import { estimateCost, type ModelPricing } from './pricing.js';

/** The clock the collector measures with. Monotonic for durations, wall-clock for stamps. */
export interface RunClock {
  /** A monotonic millisecond reading (`performance.now()`), for durations. */
  nowMs(): number;
  /** The current instant as ISO-8601 UTC, for stamps. */
  nowIso(): string;
}

/** The default clock. */
export const systemClock: RunClock = {
  nowMs: () => performance.now(),
  nowIso: () => new Date().toISOString(),
};

/** Who and what a run is (all trusted, server-side values). */
export interface RunMeta {
  runId: string;
  requestId?: string;
  correlationId?: string;
  tenantId: string;
  workspaceId?: string;
  actorId: string;
  agentId?: string;
  delegationId?: string;
  origin: RuntimeOrigin;
}

/** The per-invocation segments the ToolExecutor reports (all in ms). */
export interface InvocationSegments {
  /** Agent-authority evaluation. */
  authorizationMs: number;
  /** Policy evaluation (execute phase). */
  policyMs: number;
  /** The tool's own execution, including retries and backoff. */
  executionMs: number;
  /** Result verification. */
  verificationMs: number;
}

const RETRIEVAL_TOOLS: Readonly<Record<string, 'knowledge' | 'documents'>> = {
  'knowledge.search': 'knowledge',
  'documents.search': 'documents',
};

const round2 = (value: number): number => Math.round(value * 100) / 100;

/**
 * Collects one run's timings as it happens and builds the immutable
 * {@link RuntimeRun}. Purely descriptive: it never affects the run.
 */
export class RunCollector {
  readonly meta: RunMeta;
  readonly #clock: RunClock;
  readonly #pricing: ModelPricing | undefined;
  readonly #startMs: number;
  readonly #startedAt: string;
  readonly #stages = new Map<RuntimeStage, { durationMs: number; count: number }>();
  readonly #models: ModelCall[] = [];
  readonly #tools: ToolCall[] = [];
  readonly #retrievals: RetrievalCall[] = [];
  readonly #policies: PolicyCall[] = [];
  #approval: ApprovalTiming | undefined;
  #firstError: { code: string; toolId: string; invocationId: string } | undefined;

  constructor(meta: RunMeta, options: { pricing?: ModelPricing; clock?: RunClock } = {}) {
    this.meta = meta;
    this.#clock = options.clock ?? systemClock;
    this.#pricing = options.pricing;
    this.#startMs = this.#clock.nowMs();
    this.#startedAt = this.#clock.nowIso();
  }

  /** Milliseconds since the run began (monotonic). */
  offset(): number {
    return round2(this.#clock.nowMs() - this.#startMs);
  }

  /** The pricing table (trusted configuration), if any. */
  get pricing(): ModelPricing | undefined {
    return this.#pricing;
  }

  /** Adds time to a stage (and counts one occurrence). Negative or non-finite values are ignored. */
  addStage(stage: RuntimeStage, durationMs: number): void {
    if (!Number.isFinite(durationMs) || durationMs < 0) {
      return;
    }
    const current = this.#stages.get(stage) ?? { durationMs: 0, count: 0 };
    this.#stages.set(stage, {
      durationMs: current.durationMs + durationMs,
      count: current.count + 1,
    });
  }

  /** Times an async operation as a stage. The operation's outcome is never affected. */
  async time<T>(stage: RuntimeStage, operation: () => Promise<T> | T): Promise<T> {
    const started = this.#clock.nowMs();
    try {
      return await operation();
    } finally {
      this.addStage(stage, this.#clock.nowMs() - started);
    }
  }

  /** Records one model call (cost is computed from TRUSTED pricing only; otherwise `null`). */
  model(call: Omit<ModelCall, 'cost' | 'currency' | 'pricingVersion'>): void {
    const priced = estimateCost(call, this.#pricing);
    this.#models.push({
      ...call,
      cost: priced?.cost ?? null,
      ...(priced === null
        ? {}
        : { currency: priced.currency, pricingVersion: priced.pricingVersion }),
    });
  }

  /** Records a policy evaluation (and its time in the POLICY stage). */
  policy(call: PolicyCall): void {
    this.#policies.push(call);
    this.addStage('POLICY', call.durationMs);
  }

  /** Records the approval facts of the run. */
  approval(timing: ApprovalTiming): void {
    this.#approval = timing;
  }

  /**
   * Records what the ToolExecutor measured for one invocation. Segments are
   * attributed to their own stages (no double counting): the tool's execution
   * time to RETRIEVAL (search tools) or EXECUTION, the rest to AUTHORIZATION,
   * POLICY and VERIFICATION. `call` is present only when a tool actually ran.
   */
  invocation(segments: InvocationSegments, call?: ToolCall, resultCount?: number): void {
    if (segments.authorizationMs > 0) this.addStage('AUTHORIZATION', segments.authorizationMs);
    if (call === undefined) {
      return;
    }
    this.#tools.push(call);
    const retrieval = RETRIEVAL_TOOLS[call.toolId];
    this.addStage(retrieval === undefined ? 'EXECUTION' : 'RETRIEVAL', segments.executionMs);
    if (segments.verificationMs > 0) this.addStage('VERIFICATION', segments.verificationMs);
    if (retrieval !== undefined) {
      this.#retrievals.push({
        retrievalId: `rtv_${call.invocationId.slice(4)}`,
        invocationId: call.invocationId,
        toolId: call.toolId,
        sourceType: retrieval,
        resultCount: resultCount ?? 0,
        durationMs: round2(segments.executionMs),
        status: call.status === 'failed' ? 'failed' : 'succeeded',
      });
    }
  }

  /**
   * Notes the first invocation error of the run (including refusals before
   * execution — a policy denial or RBAC block never produces a ToolCall). Used
   * to classify a run that has no orchestrator steps (an MCP tool call).
   */
  noteError(code: string, toolId: string, invocationId: string): void {
    this.#firstError ??= { code, toolId, invocationId };
  }

  /** The first invocation error noted, if any. */
  get firstError(): { code: string; toolId: string; invocationId: string } | undefined {
    return this.#firstError;
  }

  /** Builds the immutable run record. */
  finish(status: RuntimeStatus, failure?: RunFailure, requestedOrigin?: RuntimeOrigin): RuntimeRun {
    const endMs = this.#clock.nowMs();
    const stages: StageTiming[] = [...this.#stages.entries()].map(([stage, value]) => ({
      stage,
      durationMs: round2(value.durationMs),
      count: value.count,
    }));
    const usageAll = this.#models.length > 0 && this.#models.every((m) => m.usageAvailable);
    const priced = this.#models.length > 0 && this.#models.every((m) => m.cost !== null);
    const first = this.#models[0];
    return {
      id: this.meta.runId,
      ...(this.meta.requestId === undefined ? {} : { requestId: this.meta.requestId }),
      ...(this.meta.correlationId === undefined ? {} : { correlationId: this.meta.correlationId }),
      tenantId: this.meta.tenantId,
      ...(this.meta.workspaceId === undefined ? {} : { workspaceId: this.meta.workspaceId }),
      actorId: this.meta.actorId,
      ...(this.meta.agentId === undefined ? {} : { agentId: this.meta.agentId }),
      ...(this.meta.delegationId === undefined ? {} : { delegationId: this.meta.delegationId }),
      origin: requestedOrigin ?? this.meta.origin,
      startedAt: this.#startedAt,
      endedAt: this.#clock.nowIso(),
      durationMs: round2(endMs - this.#startMs),
      status,
      ...(failure === undefined ? {} : { failure }),
      stages,
      models: this.#models,
      // Start order: a workflow's own call starts before (but finishes after) its inner steps.
      tools: [...this.#tools].sort((a, b) => a.startOffsetMs - b.startOffsetMs),
      retrievals: this.#retrievals,
      policies: this.#policies,
      ...(this.#approval === undefined ? {} : { approval: this.#approval }),
      ...(this.#tools.length === 0 ? {} : { verified: this.#tools.every((t) => t.verified) }),
      ...(first === undefined ? {} : { provider: first.provider, modelExecution: first.execution }),
      ...(first?.model === undefined ? {} : { model: first.model }),
      tokenUsage: {
        available: usageAll,
        promptTokens: this.#models.reduce(
          (s, m) => s + (m.usageAvailable ? (m.promptTokens ?? 0) : 0),
          0,
        ),
        completionTokens: this.#models.reduce(
          (s, m) => s + (m.usageAvailable ? (m.completionTokens ?? 0) : 0),
          0,
        ),
        totalTokens: this.#models.reduce(
          (s, m) => s + (m.usageAvailable ? (m.totalTokens ?? 0) : 0),
          0,
        ),
      },
      cost: {
        estimated: priced
          ? Math.round(this.#models.reduce((s, m) => s + (m.cost ?? 0), 0) * 1e8) / 1e8
          : null,
        ...(priced && first?.currency !== undefined ? { currency: first.currency } : {}),
        ...(priced && first?.pricingVersion !== undefined
          ? { pricingVersion: first.pricingVersion }
          : {}),
      },
      schemaVersion: 1,
    };
  }
}

/** Where finished runs go. Best-effort: a failing sink never affects a run. */
export type RuntimeRunSink = (run: RuntimeRun) => Promise<void> | void;

/**
 * The per-process registry of runs in flight. The orchestrator (or an MCP tool
 * wrapper) BEGINS a run; the ToolExecutor and model path REPORT to it by run
 * key; the owner FINISHES it. Reports for an unknown key are ignored, so
 * telemetry can never fail a call.
 */
export class RunTelemetryHub {
  readonly #active = new Map<string, RunCollector>();
  readonly #pricing: ModelPricing | undefined;
  readonly #clock: RunClock;
  readonly #sink: RuntimeRunSink | undefined;

  constructor(options: { pricing?: ModelPricing; clock?: RunClock; sink?: RuntimeRunSink } = {}) {
    this.#pricing = options.pricing;
    this.#clock = options.clock ?? systemClock;
    this.#sink = options.sink;
  }

  /** Starts collecting a run under its run id. */
  begin(meta: RunMeta): RunCollector {
    const collector = new RunCollector(meta, {
      ...(this.#pricing === undefined ? {} : { pricing: this.#pricing }),
      clock: this.#clock,
    });
    // A bounded registry: a run that never finished cannot leak memory forever.
    if (this.#active.size >= 10_000) {
      const oldest = this.#active.keys().next().value as string | undefined;
      if (oldest !== undefined) this.#active.delete(oldest);
    }
    this.#active.set(meta.runId, collector);
    return collector;
  }

  /** The in-flight collector for a run key, if any. */
  get(runKey: string): RunCollector | undefined {
    return this.#active.get(runKey);
  }

  /** Finishes a run: removes it from the registry, persists it best-effort, and returns the record. */
  async end(
    runId: string,
    status: RuntimeStatus,
    failure?: RunFailure,
  ): Promise<RuntimeRun | undefined> {
    const collector = this.#active.get(runId);
    if (collector === undefined) {
      return undefined;
    }
    this.#active.delete(runId);
    const run = collector.finish(status, failure);
    try {
      await this.#sink?.(run);
    } catch {
      // Telemetry is descriptive and best-effort: it can never change an outcome.
    }
    return run;
  }
}
