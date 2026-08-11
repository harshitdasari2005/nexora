/**
 * @nexora/ai-runtime — telemetry.
 *
 * The monitoring runtime's records (AIR.md §1.2 R15, §16): execution
 * traces, prompt records, decisions, token usage, latency, and cost. All
 * records are written at decision time (ADR-011) — the timelines are
 * rendered from these records, never reconstructed.
 */

import type { Timestamp } from '@nexora/contracts/common';
import type { DecisionRecord } from '../reasoning/index.js';
import type { TokenUsage } from '../providers/chat-provider.js';

/** A stage of an execution trace. */
export interface TraceStage {
  /** Stage id (intent, discovery, planning, execution, verification, ...). */
  stage: string;
  /** ISO-8601 UTC time the stage started. */
  startedAt: Timestamp;
  /** ISO-8601 UTC time the stage finished, when finished. */
  finishedAt?: Timestamp;
  /** Stage outcome. */
  status: 'running' | 'succeeded' | 'failed';
  /** Optional stage output (e.g. matched capability ids). */
  detail?: string;
}

/** A run-level execution trace. */
export interface ExecutionTrace {
  /** Run id the trace belongs to. */
  runId: string;
  /** The stages the run traversed, in order. */
  stages: readonly TraceStage[];
  /** Overall run outcome. */
  outcome: 'completed' | 'partial' | 'unverified' | 'failed' | 'blocked';
  /** ISO-8601 UTC time the run started. */
  startedAt: Timestamp;
  /** ISO-8601 UTC time the run finished, when finished. */
  finishedAt?: Timestamp;
}

/** A prompt-usage record. */
export interface PromptRecord {
  /** Prompt record id. */
  id: string;
  /** The template id rendered, when template-driven. */
  templateId?: string;
  /** The template version, when template-driven. */
  templateVersion?: string;
  /** The model that served the prompt, when a provider ran. */
  model?: string;
  /** Token usage, when reported. */
  tokenUsage?: TokenUsage;
  /** ISO-8601 UTC time the prompt was served. */
  servedAt: Timestamp;
}

/** A latency sample for a stage. */
export interface LatencyMetrics {
  /** Stage id the sample belongs to. */
  stage: string;
  /** Run id, when run-scoped. */
  runId?: string;
  /** Duration, in milliseconds. */
  durationMs: number;
  /** ISO-8601 UTC time the sample was taken. */
  at: Timestamp;
}

/** A cost sample. */
export interface CostMetrics {
  /** Run id, when run-scoped. */
  runId?: string;
  /** Cost in the platform accounting unit. */
  cost: number;
  /** Optional breakdown by resource. */
  breakdown?: Readonly<Record<string, number>>;
  /** ISO-8601 UTC time the sample was taken. */
  at: Timestamp;
}

/** The union of all telemetry records. */
export type TelemetryRecord =
  | { kind: 'trace'; trace: ExecutionTrace }
  | { kind: 'decision'; decision: DecisionRecord }
  | { kind: 'prompt'; prompt: PromptRecord }
  | { kind: 'latency'; latency: LatencyMetrics }
  | { kind: 'cost'; cost: CostMetrics };

/** The telemetry sink: the monitoring runtime's intake. */
export interface TelemetrySink {
  /** Records a telemetry record. */
  record(record: TelemetryRecord): void;
}
