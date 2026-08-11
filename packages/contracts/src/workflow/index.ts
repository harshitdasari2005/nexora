/**
 * @nexora/contracts — workflow contracts.
 *
 * The workflow engine contracts (SAD.md §12, PSD.md §8 WRK-*): definitions,
 * steps, context, results, compensation, and approval points. Journaled
 * execution (saga semantics) drives every field below (BKD.md §8.2).
 */

import type { CorrelationId, TenantId, Timestamp, WorkspaceId } from '../common/index.js';

/** Status of a workflow definition (validated before activation). */
export type WorkflowDefinitionStatus = 'draft' | 'validated' | 'active' | 'retired';

/**
 * A workflow definition step. Steps are the unit of execution; a step may be
 * an AI task, a human task, or a decision.
 */
export interface WorkflowStep {
  /** Unique step id within the definition. */
  id: string;
  /** Human-readable step name. */
  name: string;
  /** Step kind: AI-executed, human-completed, or a decision branch. */
  kind: 'ai_task' | 'human_task' | 'decision';
  /** Capability/skill id invoked for AI tasks (AIR.md §5). */
  capabilityId?: string;
  /** The tool id invoked for AI tasks — the capability's executable tool. */
  toolId?: string;
  /**
   * Step input. Values are bound from the workflow input/accumulated state
   * at execution time; a `{{key}}` placeholder resolves `key` from the
   * workflow input or state (deterministic binding — never identity).
   */
  input?: Record<string, unknown>;
  /**
   * Step ids that must SUCCEED before this step runs. The engine evaluates
   * readiness from this list and never executes a step whose dependencies
   * are unsatisfied. Steps without dependencies are ready on start.
   */
  dependsOn?: readonly string[];
  /** Human actor role assigned for human tasks. */
  assigneeRole?: string;
  /** Next step ids by outcome; decision steps route by condition. */
  next: Readonly<Record<string, string>>;
  /** Retry budget for the step, when retryable (SAD.md §12.6). */
  retryPolicy?: {
    /** Maximum attempts before the step fails. */
    maxAttempts: number;
    /** Backoff between attempts, in milliseconds. */
    backoffMs: number;
  };
}

/**
 * An approval point: which actors must approve before the workflow proceeds
 * (AIR.md §12).
 */
export interface ApprovalPoint {
  /** Approver role(s) allowed to decide. */
  approverRoles: readonly string[];
  /** Timeout after which the approval escalates (AIR.md §12.5). */
  timeoutMs: number;
  /** Whether approval may be delegated (AIR.md §12.6). */
  delegatable: boolean;
}

/**
 * A compensation specification: the action taken to undo a step when a later
 * step fails (saga semantics, SAD.md §12.7).
 */
export interface CompensationSpec {
  /** Step id this compensation undoes. */
  forStepId: string;
  /** Capability/skill id invoked to compensate. */
  capabilityId: string;
  /** Whether compensation itself requires approval (side effects). */
  requiresApproval: boolean;
}

/**
 * A workflow definition (WRK-*, SAD.md §12.2). Definitions are versioned and
 * validated before activation.
 */
export interface WorkflowDefinition {
  /** Definition id (`wfd_...`). */
  id: string;
  /** Stable key, e.g. `hr.onboarding`. */
  key: string;
  /** Definition version. */
  version: number;
  /** Entry step id. */
  startStepId: string;
  /** All steps of the workflow. */
  steps: readonly WorkflowStep[];
  /** Approval points keyed by step id (AIR.md §12). */
  approvalPoints: Readonly<Record<string, ApprovalPoint>>;
  /** Compensation specs, when the workflow supports rollback (SAD.md §12.7). */
  compensation?: readonly CompensationSpec[];
  /** Timeout for the whole workflow, in milliseconds. */
  timeoutMs: number;
  /** Definition lifecycle status. */
  status: WorkflowDefinitionStatus;
}

/** Runtime state of a workflow step instance. */
export type WorkflowStepStatus = 'pending' | 'running' | 'succeeded' | 'failed' | 'skipped';

/**
 * The lifecycle status of a {@link WorkflowInstance} (SAD.md §12.4):
 * `created` → `planning` → `ready` → `running` → (`awaiting_approval` ⇄
 * `running`) → `succeeded` / `failed` / `cancelled` / `compensated`.
 * Terminal states (`succeeded`, `failed`, `cancelled`, `compensated`) have
 * no outgoing transitions.
 */
export type WorkflowInstanceStatus =
  | 'created'
  | 'planning'
  | 'ready'
  | 'running'
  | 'awaiting_approval'
  | 'succeeded'
  | 'failed'
  | 'cancelled'
  | 'compensated';

/**
 * A workflow instance at runtime.
 */
export interface WorkflowInstance {
  /** Instance id (`wfi_...`). */
  id: string;
  /** The definition this instance executes. */
  definitionId: string;
  /** Stable definition key, e.g. `projects.create_and_assign_employee`. */
  definitionKey: string;
  /** Tenant the instance belongs to. */
  tenantId: TenantId;
  /** The initiating user (trusted context). */
  userId: string;
  /** The workspace scope, when workspace-scoped (trusted context). */
  workspaceId?: WorkspaceId;
  /** Correlation id tying the instance to its originating conversation. */
  correlationId: CorrelationId;
  /** Overall instance state. */
  status: WorkflowInstanceStatus;
  /** Current step id, when running. */
  currentStepId?: string;
  /** The failure message, when the instance failed (read model). */
  error?: string;
  /** ISO-8601 UTC time the instance started. */
  startedAt: Timestamp;
  /** ISO-8601 UTC time the instance finished, when finished. */
  finishedAt?: Timestamp;
}

/**
 * The context a workflow instance executes with: the initiating actor, the
 * input payload, and accumulated state shared across steps.
 */
export interface WorkflowContext {
  /** Instance id. */
  instanceId: string;
  /** Tenant (organization) the instance belongs to (trusted). */
  tenantId: TenantId;
  /** The actor that started the workflow. */
  initiator: string;
  /** Workspace scope, when workspace-scoped (trusted). */
  workspaceId?: WorkspaceId;
  /** Correlation id of the originating execution (trusted). */
  correlationId: CorrelationId;
  /** The workflow input payload. */
  input: Record<string, unknown>;
  /** Shared state accumulated by executed steps. */
  state: Record<string, unknown>;
}

/**
 * A persisted step execution record (the workflow journal, SAD.md §12.6).
 * One record per (workflow, step, attempt); the `executionKey`
 * (`workflowId:stepId:attempt`) is the idempotency identity — a duplicate
 * delivery can never create a second mutation for the same attempt.
 */
export interface WorkflowStepExecution {
  /** Execution id (`wfx_...`). */
  id: string;
  /** The owning workflow instance. */
  workflowId: string;
  /** Tenant the execution belongs to. */
  tenantId: TenantId;
  /** The executed step id (from the definition). */
  stepId: string;
  /** Human-readable step name (snapshot for read models). */
  name: string;
  /** The capability executed. */
  capabilityId: string;
  /** The tool invoked. */
  toolId: string;
  /** The step execution state. */
  status: WorkflowStepStatus;
  /** 1-based attempt number (retries increment it). */
  attempt: number;
  /** Idempotency key: `${workflowId}:${stepId}:${attempt}`. */
  executionKey: string;
  /** The bound step input at execution time. */
  input: Record<string, unknown>;
  /** The tool output on success. */
  output?: unknown;
  /** The failure message when the step failed. */
  error?: string;
  /** The approval request id, when the step waits for approval. */
  approvalId?: string;
  /** ISO-8601 UTC time the step execution started. */
  startedAt: Timestamp;
  /** ISO-8601 UTC time the step execution finished, when finished. */
  finishedAt?: Timestamp;
}

/**
 * A full execution record: the instance plus its step journal — what a
 * workflow query returns (read model for the workflow UI and audit).
 */
export interface WorkflowExecutionRecord {
  /** The workflow instance. */
  instance: WorkflowInstance;
  /** Step executions, in definition order. */
  steps: readonly WorkflowStepExecution[];
}

/**
 * The result of a completed workflow instance.
 */
export interface WorkflowResult {
  /** Instance id. */
  instanceId: string;
  /** Final instance status. */
  status: 'succeeded' | 'failed' | 'cancelled' | 'compensated';
  /** Output payload produced by the workflow. */
  output?: Record<string, unknown>;
  /** Steps that were compensated, when rollback occurred. */
  compensatedSteps?: readonly string[];
  /** ISO-8601 UTC time the instance finished. */
  finishedAt: Timestamp;
}
