/**
 * @nexora/agent-sdk — core types.
 *
 * The SDK's own vocabulary: branded identifiers, execution phases, and
 * execution metadata. Everything else builds on the canonical contracts
 * (`@nexora/contracts`) and shared utilities (`@nexora/shared`); this module
 * adds only what is SDK-specific.
 */

/**
 * An agent id (`agt_...`). Plain string to stay compatible with the
 * canonical `AgentIdentity.id` in `@nexora/contracts/ai` — values are
 * created with `@nexora/shared/ids` `prefixedId('agt')`.
 */
export type AgentId = string;

/** An execution id (`exe_...`). */
export type ExecutionId = string;

/** A tool id (`tool_...`). */
export type ToolId = string;

/** A skill id, e.g. `hr.hire_employee`. */
export type SkillId = string;

/** A capability id, e.g. `projects.create_project`. */
export type CapabilityId = string;

/**
 * Execution phases an agent goes through (AIR.md §7 reasoning pipeline).
 * Used for observability and the execution timeline.
 */
export const EXECUTION_PHASES = [
  'intent',
  'context',
  'planning',
  'reasoning',
  'approval',
  'execution',
  'verification',
  'completed',
] as const;

/** Single execution phase literal. */
export type ExecutionPhase = (typeof EXECUTION_PHASES)[number];

/**
 * A typed execution failure: a stable code plus message, returned (not
 * thrown) for expected failures (ENGINEERING_PLAYBOOK.md §4.2).
 */
export interface ExecutionFailure {
  /** Stable machine-readable code (API_CONTRACTS.md §10). */
  code: string;
  /** Human-readable message. */
  message: string;
}

/**
 * Run-level metadata attached to an execution result for observability
 * (AIR.md §16 execution timeline).
 *
 * Distinct from the canonical `ExecutionMetadata` in `@nexora/contracts/ai`,
 * which records an individual tool/skill execution; this is the whole-run
 * envelope (approval outcome, agent, timing).
 */
export interface ExecutionResultMetadata {
  /** Execution id. */
  executionId: ExecutionId;
  /** Agent id that performed the execution. */
  agentId: AgentId;
  /** ISO-8601 UTC time execution started. */
  startedAt: string;
  /** ISO-8601 UTC time execution finished, when finished. */
  finishedAt?: string;
  /** Whether the execution required human approval. */
  requiredApproval: boolean;
  /** Whether approval was granted. */
  approvalGranted?: boolean;
}

/**
 * The result of an agent execution. `ok` discriminates success from failure;
 * failures carry a stable code and message (API error taxonomy,
 * API_CONTRACTS.md §10).
 */
export type ExecutionResult<TOutput = unknown> =
  | { ok: true; output: TOutput; metadata: ExecutionResultMetadata }
  | { ok: false; code: string; message: string; metadata: ExecutionResultMetadata };

/** Constructs a successful execution result. */
export function executionOk<TOutput>(
  output: TOutput,
  metadata: ExecutionResultMetadata,
): ExecutionResult<TOutput> {
  return { ok: true, output, metadata };
}

/** Constructs a failed execution result. */
export function executionErr<TOutput>(
  code: string,
  message: string,
  metadata: ExecutionResultMetadata,
): ExecutionResult<TOutput> {
  return { ok: false, code, message, metadata };
}
