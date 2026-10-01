/**
 * @nexora/module-observability — the runtime run model (Prompt 7).
 *
 * Three questions, three systems, never blurred:
 * - AUDIT answers "what happened?"
 * - LINEAGE answers "what data / evidence / result was connected to it?"
 * - OBSERVABILITY (this module) answers "how did the runtime PERFORM?"
 *
 * A {@link RuntimeRun} is one row per orchestrated run (or MCP tool call): its
 * end-to-end timing, per-stage timing, the model calls it made (provider,
 * model, latency, token usage when the provider reported it), the tools it
 * called, and — when it failed — WHERE and WHY. It references the ids other
 * systems own (run / invocation / approval / delegation / lineage) and never
 * duplicates their content.
 *
 * It is DESCRIPTIVE ONLY. Nothing here is an input to RBAC, delegation,
 * policy or approval, and nothing here stores prompts, tool arguments,
 * documents, secrets, or model reasoning — only ids, codes, counts, durations
 * and fingerprints. Unavailable facts stay `null`/absent: token usage that a
 * provider did not report is `usageAvailable: false`, never an estimate; a
 * cost without a configured price is `null`, never invented.
 */

/** The stages a run can spend time in (unused stages are simply absent). */
export const RUNTIME_STAGES = [
  'REQUEST',
  'PLANNING',
  'RETRIEVAL',
  'AUTHORIZATION',
  'POLICY',
  'APPROVAL',
  'EXECUTION',
  'VERIFICATION',
  'NARRATION',
] as const;

/** A runtime stage. */
export type RuntimeStage = (typeof RUNTIME_STAGES)[number];

/** How a run ended (the orchestrator's own vocabulary). */
export type RuntimeStatus = 'completed' | 'failed' | 'blocked' | 'clarification';

/** Where a run entered the runtime. */
export type RuntimeOrigin = 'chat' | 'agent' | 'mcp' | 'remediation' | 'workflow' | 'orchestrator';

/**
 * Deterministic failure classes — WHY the run stopped, in operator terms:
 * a security/authorization refusal is not an infrastructure failure.
 */
export type FailureClass =
  /** Refused by RBAC, agent authority, policy or an argument guard (working as designed). */
  | 'DENIED'
  /** The action needed a human decision that did not produce execution (mismatch / changed policy). */
  | 'APPROVAL'
  /** The request or its arguments were not valid. */
  | 'INPUT'
  /** A tool ran and failed. */
  | 'EXECUTION'
  /** The result could not be verified. */
  | 'VERIFICATION'
  /** A dependency (model provider, connector, database) failed or was unavailable. */
  | 'INFRASTRUCTURE'
  /** A known timeout. */
  | 'TIMEOUT'
  /** An unclassified internal error. */
  | 'INTERNAL';

/** The failure taxonomy — only codes with real failure paths. */
export const FAILURE_CODES = [
  'REQUEST_INVALID',
  'RBAC_DENIED',
  'AGENT_DENIED',
  'ARGUMENT_TRUST_VIOLATION',
  'POLICY_DENIED',
  'POLICY_UNAVAILABLE',
  'POLICY_CHANGED_AFTER_APPROVAL',
  'APPROVAL_MISMATCH',
  'APPROVAL_EXPIRED',
  'APPROVAL_NOT_BOUND',
  'TOOL_ARGUMENT_INVALID',
  'TOOL_EXECUTION_FAILED',
  'TOOL_TIMEOUT',
  'RETRIEVAL_FAILED',
  'WORKFLOW_FAILED',
  'CONNECTOR_UNAVAILABLE',
  'VERIFICATION_FAILED',
  'MODEL_ERROR',
  'MODEL_TIMEOUT',
  'INTERNAL_ERROR',
] as const;

/** A failure code. */
export type FailureCode = (typeof FAILURE_CODES)[number];

/** WHERE and WHY a run failed. */
export interface RunFailure {
  stage: RuntimeStage;
  code: FailureCode;
  class: FailureClass;
  /** The raw executor/adapter code the taxonomy code was derived from (a code, never a message). */
  sourceCode?: string;
  toolId?: string;
  invocationId?: string;
}

/** Time spent in one stage. Only stages that were used are present. */
export interface StageTiming {
  stage: RuntimeStage;
  durationMs: number;
  /** How many times the stage ran (e.g. tool executions). */
  count: number;
}

/** One model call. */
export interface ModelCall {
  /** `mdl_…` */
  callId: string;
  purpose: 'narration';
  /** The adapter id, e.g. `ollama` or `groq`. */
  provider: string;
  /** The model that served (or was asked to serve) the call. */
  model?: string;
  /** Whether the request left the deployment boundary. */
  execution: 'local' | 'cloud' | 'unknown';
  /** Offset from the run start, ms. */
  startOffsetMs: number;
  durationMs: number;
  status: 'succeeded' | 'failed';
  /** For a failed call: the taxonomy code (`MODEL_TIMEOUT` | `MODEL_ERROR`). */
  errorCode?: FailureCode;
  /** Attempts beyond the first (the model path does not retry today: 0). */
  retries: number;
  /** Whether the provider REPORTED token usage. `false` means unknown — never estimated. */
  usageAvailable: boolean;
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
  /** Estimated cost from TRUSTED pricing configuration; `null` when unknown. */
  cost: number | null;
  currency?: string;
  pricingVersion?: string;
  finishReason?: string;
  /** Which prompt template produced the input (never the prompt itself). */
  promptTemplateId?: string;
  promptVersion?: string;
  /** sha256 fingerprints of the input messages / the output text (integrity, not content). */
  inputFingerprint?: string;
  outputFingerprint?: string;
  /** Whether the run used the model's text, or fell back to the deterministic composer. */
  narrationSource?: 'model' | 'deterministic' | 'fallback';
  /** Why the deterministic fallback was used (a code). */
  fallbackReason?: 'MODEL_ERROR' | 'MODEL_TIMEOUT' | 'EMPTY_OUTPUT' | 'DISCLOSURE_DISCARDED';
}

/** A per-attempt retry record (tool retries). */
export interface RetryRecord {
  /** The attempt that failed (1-based). */
  attempt: number;
  errorCode: string;
  /** Backoff before the next attempt, ms. */
  delayMs: number;
  /** Retries are only ever for transient infrastructure faults; security denials never retry. */
  reason: 'TRANSIENT_INFRASTRUCTURE';
}

/** The policy decision a call was made under (referenced; policy stays authoritative). */
export interface PolicyRef {
  policyId: string;
  version: string;
  outcome: 'ALLOW' | 'DENY' | 'REQUIRE_APPROVAL';
}

/** One tool invocation that actually ran. */
export interface ToolCall {
  /** The executor's invocation id (`inv_…`) — the same id lineage records. */
  invocationId: string;
  toolId: string;
  capabilityId?: string;
  origin: string;
  startOffsetMs: number;
  durationMs: number;
  status: 'succeeded' | 'failed' | 'unverified';
  errorCode?: string;
  attempts: number;
  retries: readonly RetryRecord[];
  verified: boolean;
  /** Time spent verifying the result, ms (part of durationMs). */
  verificationMs: number;
  policy?: PolicyRef;
  delegationId?: string;
  approvalId?: string;
  workflow?: { stepId?: string; purpose?: 'step' | 'compensation' };
}

/** One retrieval (knowledge / document search). */
export interface RetrievalCall {
  /** `rtv_…` */
  retrievalId: string;
  invocationId: string;
  toolId: string;
  sourceType: 'knowledge' | 'documents';
  resultCount: number;
  durationMs: number;
  status: 'succeeded' | 'failed';
}

/** One policy evaluation. */
export interface PolicyCall extends PolicyRef {
  phase: 'precheck' | 'execute';
  durationMs: number;
}

/** Approval facts of a run — the human wait is NEVER part of the run's own latency. */
export interface ApprovalTiming {
  approvalId: string;
  /** `opened`: this run raised the gate; `resumed`: this run executed after a decision. */
  state: 'opened' | 'resumed' | 'expired';
  createdAt?: string;
  decidedAt?: string;
  /** decidedAt − createdAt: how long the human took. Absent until decided. */
  waitMs?: number;
  decision?: 'grant' | 'reject';
  /**
   * The user who decided the approval (descriptive only: never read by any
   * authorization decision; the run's actor stays the requester).
   */
  decidedBy?: string;
}

/** The persisted run record. */
export interface RuntimeRun {
  /** The run id (`run_…`) — the same id approvals, lineage and audit use. */
  id: string;
  /** The HTTP request id that started it, when one exists. */
  requestId?: string;
  /** Groups runs of one session/instance (an MCP session, a workflow instance). */
  correlationId?: string;
  tenantId: string;
  workspaceId?: string;
  actorId: string;
  agentId?: string;
  delegationId?: string;
  origin: RuntimeOrigin;
  startedAt: string;
  endedAt: string;
  /** End-to-end latency of THIS run, excluding any human approval wait. */
  durationMs: number;
  status: RuntimeStatus;
  failure?: RunFailure;
  stages: readonly StageTiming[];
  models: readonly ModelCall[];
  tools: readonly ToolCall[];
  retrievals: readonly RetrievalCall[];
  policies: readonly PolicyCall[];
  approval?: ApprovalTiming;
  /** Whether every executed tool result was verified (absent when nothing executed). */
  verified?: boolean;
  /** Denormalized summary of the model path (for filtering/comparison). */
  provider?: string;
  model?: string;
  modelExecution?: 'local' | 'cloud' | 'unknown';
  /** Tokens across model calls. `available` is true only if every call reported usage. */
  tokenUsage: {
    available: boolean;
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
  /** Cost across model calls; `estimated` is `null` unless every call was priced from trusted config. */
  cost: { estimated: number | null; currency?: string; pricingVersion?: string };
  schemaVersion: 1;
}

/** Filters for reading runs (always tenant-scoped by the caller). */
export interface RuntimeRunQuery {
  workspaceId?: string;
  status?: RuntimeStatus;
  failureStage?: RuntimeStage;
  failureClass?: FailureClass;
  provider?: string;
  model?: string;
  agentId?: string;
  actorId?: string;
  origin?: RuntimeOrigin;
  requestId?: string;
  /**
   * Runs that opened or resumed this approval (`approval.approvalId`) or whose
   * tool calls executed under it (`tools[].approvalId`).
   */
  approvalId?: string;
  /** Runs that executed this tool invocation (`tools[].invocationId`). */
  invocationId?: string;
  /** ISO-8601 inclusive lower / upper bound on `startedAt`. */
  from?: string;
  to?: string;
  limit?: number;
}

/** The append-only run store. There is deliberately no update or delete. */
export interface RuntimeRunRepository {
  append(run: RuntimeRun): Promise<void>;
  /** Newest first. Always scoped to `tenantId`; the workspace filter narrows further. */
  list(tenantId: string, query?: RuntimeRunQuery): Promise<readonly RuntimeRun[]>;
  /** One run by id inside the tenant, or `undefined` (a foreign id is indistinguishable from a missing one). */
  get(tenantId: string, runId: string): Promise<RuntimeRun | undefined>;
}
