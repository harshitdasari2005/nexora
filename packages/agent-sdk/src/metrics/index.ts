/**
 * @nexora/agent-sdk — metrics.
 *
 * Agent metrics (AIR.md §16): execution, latency, usage, token, and cost
 * metrics. The SDK records metrics through a `MetricsRecorder`; the platform
 * plugs in the real recorder (e.g. OpenTelemetry) at runtime — the SDK is
 * provider-independent.
 */

/** Execution counts over a window. */
export interface ExecutionMetrics {
  /** Total executions started. */
  executionsStarted: number;
  /** Executions that succeeded. */
  executionsSucceeded: number;
  /** Executions that failed. */
  executionsFailed: number;
}

/** Latency statistics for executions. */
export interface LatencyMetrics {
  /** Total executions sampled. */
  sampleCount: number;
  /** Sum of latencies, in milliseconds. */
  totalLatencyMs: number;
  /** Mean latency, in milliseconds (0 when no samples). */
  averageLatencyMs: number;
}

/** Resource usage counters. */
export interface UsageMetrics {
  /** Number of tool invocations. */
  toolInvocations: number;
  /** Number of knowledge retrievals. */
  knowledgeRetrievals: number;
  /** Number of approval requests raised. */
  approvalsRequested: number;
}

/** Token consumption. */
export interface TokenMetrics {
  /** Prompt tokens consumed. */
  promptTokens: number;
  /** Completion tokens consumed. */
  completionTokens: number;
}

/** Cost tracking for an execution. */
export interface CostMetrics {
  /** Cost in the platform accounting unit (e.g. micro-credits). */
  cost: number;
  /** Optional breakdown by resource. */
  breakdown?: Readonly<Record<string, number>>;
}

/**
 * The metrics recorder contract. The platform provides the real
 * implementation; the in-memory recorder in this module is for tests and
 * local development.
 */
export interface MetricsRecorder {
  /** Records execution outcome counters. */
  recordExecution(metrics: ExecutionMetrics): void;
  /** Records a latency sample, in milliseconds. */
  recordLatency(latencyMs: number): void;
  /** Records usage counters. */
  recordUsage(metrics: UsageMetrics): void;
  /** Records token consumption. */
  recordTokens(metrics: TokenMetrics): void;
  /** Records cost. */
  recordCost(metrics: CostMetrics): void;
}

/** A no-op metrics recorder (safe default). */
export class NoopMetricsRecorder implements MetricsRecorder {
  recordExecution(_metrics: ExecutionMetrics): void {}
  recordLatency(_latencyMs: number): void {}
  recordUsage(_metrics: UsageMetrics): void {}
  recordTokens(_metrics: TokenMetrics): void {}
  recordCost(_metrics: CostMetrics): void {}
}

/**
 * An in-memory metrics recorder for tests and local development. Snapshots
 * can be read back for assertions.
 */
export class InMemoryMetricsRecorder implements MetricsRecorder {
  #executions: ExecutionMetrics = {
    executionsStarted: 0,
    executionsSucceeded: 0,
    executionsFailed: 0,
  };
  #latencySamples: number[] = [];
  #usage: UsageMetrics = { toolInvocations: 0, knowledgeRetrievals: 0, approvalsRequested: 0 };
  #tokens: TokenMetrics = { promptTokens: 0, completionTokens: 0 };
  #cost: CostMetrics = { cost: 0 };

  recordExecution(metrics: ExecutionMetrics): void {
    this.#executions = {
      executionsStarted: this.#executions.executionsStarted + metrics.executionsStarted,
      executionsSucceeded: this.#executions.executionsSucceeded + metrics.executionsSucceeded,
      executionsFailed: this.#executions.executionsFailed + metrics.executionsFailed,
    };
  }

  recordLatency(latencyMs: number): void {
    this.#latencySamples.push(latencyMs);
  }

  recordUsage(metrics: UsageMetrics): void {
    this.#usage = {
      toolInvocations: this.#usage.toolInvocations + metrics.toolInvocations,
      knowledgeRetrievals: this.#usage.knowledgeRetrievals + metrics.knowledgeRetrievals,
      approvalsRequested: this.#usage.approvalsRequested + metrics.approvalsRequested,
    };
  }

  recordTokens(metrics: TokenMetrics): void {
    this.#tokens = {
      promptTokens: this.#tokens.promptTokens + metrics.promptTokens,
      completionTokens: this.#tokens.completionTokens + metrics.completionTokens,
    };
  }

  recordCost(metrics: CostMetrics): void {
    this.#cost = { cost: this.#cost.cost + metrics.cost, breakdown: metrics.breakdown };
  }

  /** Execution counters accumulated so far. */
  get executions(): Readonly<ExecutionMetrics> {
    return this.#executions;
  }

  /** Latency statistics accumulated so far. */
  get latency(): LatencyMetrics {
    const total = this.#latencySamples.reduce((sum, sample) => sum + sample, 0);
    return {
      sampleCount: this.#latencySamples.length,
      totalLatencyMs: total,
      averageLatencyMs: this.#latencySamples.length === 0 ? 0 : total / this.#latencySamples.length,
    };
  }

  /** Usage counters accumulated so far. */
  get usage(): Readonly<UsageMetrics> {
    return this.#usage;
  }

  /** Token counters accumulated so far. */
  get tokens(): Readonly<TokenMetrics> {
    return this.#tokens;
  }

  /** Cost accumulated so far. */
  get cost(): Readonly<CostMetrics> {
    return this.#cost;
  }
}
