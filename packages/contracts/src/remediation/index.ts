/**
 * @nexora/contracts — governed remediation planning & execution contracts
 * (Phase 10).
 *
 * The generic vocabulary of the remediation layer, built ON TOP of S27
 * (problem → investigation → known solution → recommendation) and S26
 * (governed agents, capabilities, execution, approval). Phase 10 turns a
 * detected problem with a known solution into a DYNAMIC, server-validated
 * remediation plan whose steps execute ONE AT A TIME through the EXISTING
 * governed execution path (AgentExecutionPort → AI Runtime → ToolExecutor →
 * ApprovalEngine → verification → decision records → journal). There is no
 * second execution engine, no second approval system, no autonomous agent:
 * every step is capability-bound, approval-gated where policy requires, and
 * verified before the plan advances.
 *
 * - A `RemediationPlan` is derived deterministically from the problem's
 *   applicable known solution + the caller's agent capability set — never
 *   hard-coded, never LLM-proposed-as-authority. The server validates the
 *   whole plan before it can enter execution (VALID or BLOCKED + reason).
 * - `PlanStep.approvalRequirement` + `requiredApproverRoleId` are the
 *   approval-ROUTING layer (who should approve, derived server-side from
 *   capability policy). The actual gate is the EXISTING ApprovalEngine: the
 *   engine opens the approval with a deterministic resume key (dedupe), the
 *   decision goes through the EXISTING `/api/ai/approvals/:id/decision`
 *   surface, and execution claims it exactly once.
 * - `status` is the plan lifecycle (DRAFT → VALIDATED → AWAITING_APPROVAL /
 *   READY → EXECUTING → … → COMPLETED/FAILED/CANCELLED/BLOCKED, with
 *   REPLANNING for state changes). Bounds (steps, replans, duration) are
 *   explicit — the plan never loops autonomously.
 *
 * Security contract (Phase 10): the client is authoritative for NOTHING —
 * tenant/workspace/role/capability/approver/approval are all resolved
 * server-side; forged plan/problem/step ids, forged roles/capabilities,
 * forged approvers, and prompt injection all fail closed.
 */

import type { AgentExecutionOutcome } from '../agent/index.js';
import type { BusinessProblemDto } from '../detection/index.js';

export type { AgentExecutionOutcome, BusinessProblemDto };

/** A stable, machine-readable remediation plan id, e.g. `rpl_…`. */
export type RemediationPlanId = string;

/** A stable, machine-readable plan step id, e.g. `rst_…`. */
export type RemediationStepId = string;

/**
 * The plan lifecycle. `DRAFT` is the freshly derived plan; the server
 * validates it into `VALIDATED`, which becomes `AWAITING_APPROVAL` when any
 * step requires approval or `READY` otherwise. Execution is sequential:
 * `EXECUTING` while a step runs, `AWAITING_APPROVAL` while a step waits for
 * a decision. `REPLANNING` marks a plan whose observed state changed; the
 * re-derived plan is a new `DRAFT` version (bounded). Terminal states:
 * `COMPLETED`, `FAILED`, `CANCELLED`, `BLOCKED` (blocked can still be
 * replanned or cancelled). `PAUSED` is reserved for human intervention.
 */
export type RemediationPlanStatus =
  | 'DRAFT'
  | 'VALIDATED'
  | 'AWAITING_APPROVAL'
  | 'READY'
  | 'EXECUTING'
  | 'PAUSED'
  | 'REPLANNING'
  | 'COMPLETED'
  | 'FAILED'
  | 'CANCELLED'
  | 'BLOCKED';

/**
 * The step lifecycle within a plan. `PENDING` → `AWAITING_APPROVAL` (when
 * the step's capability requires approval) → `RUNNING` → `VERIFIED` |
 * `FAILED` | `BLOCKED`. `SKIPPED` marks a step whose dependencies were not
 * satisfied (never executed). A step executes at most once — the engine's
 * atomic claim (and the approval claim) make a duplicate advance request
 * replay the recorded outcome instead of re-running the action.
 */
export type PlanStepStatus =
  'PENDING' | 'AWAITING_APPROVAL' | 'RUNNING' | 'VERIFIED' | 'BLOCKED' | 'FAILED' | 'SKIPPED';

/**
 * The approval requirement of a step, derived server-side from the
 * capability's side-effect class + the routing policy. `REQUIRED` means the
 * step executes only after a GRANTED decision through the existing
 * ApprovalEngine — the client can never waive it.
 */
export type PlanApprovalRequirement = 'NONE' | 'REQUIRED';

/** The outcome of a completed plan (final verification). */
export interface RemediationOutcomeDto {
  /** Whether the re-evaluation of the original problem found it resolved. */
  status: 'resolved' | 'unresolved';
  /** The final deterministic verification statement. */
  finalVerification: string;
  /** ISO-8601 UTC time of the final verification. */
  verifiedAt: string;
}

/**
 * One remediation plan step: WHAT will happen, WHY, WHICH capability it
 * requires, whether approval is required (and who should approve), WHAT it
 * depends on, and HOW success will be verified. A step maps into the
 * existing governed execution system: the engine executes it as a
 * capability-bound `AgentExecutionIntent` (the SAME intent shape the S26
 * agent surface uses), so approval, ToolExecutor, verification, decision
 * records, and audit all continue through the existing runtime.
 */
export interface PlanStepDto {
  /** Stable step id. */
  id: RemediationStepId;
  /** The owning plan id. */
  planId: RemediationPlanId;
  /** 1-based sequence within the plan (execution order). */
  sequence: number;
  /** Human-readable action label (WHAT will happen). */
  action: string;
  /** The capability required to execute the step. */
  capabilityId: string;
  /** A description of what the step does. */
  description: string;
  /** WHY the step is needed (grounded in the known solution). */
  rationale: string;
  /** Step ids this step depends on (executed first). */
  dependencies: readonly RemediationStepId[];
  /** The derived approval requirement. */
  approvalRequirement: PlanApprovalRequirement;
  /** The server-derived approver role, when approval is required. */
  requiredApproverRoleId?: string;
  /** HOW success will be verified. */
  verificationRequirement: string;
  /** The current step lifecycle. */
  status: PlanStepStatus;
  /** The display-safe result of a completed step. */
  result?: unknown;
  /** Display-safe verification notes recorded with the step. */
  evidence?: readonly string[];
  /** The recorded approval request id, when one was opened. */
  approvalId?: string;
  /** ISO-8601 UTC time the step started executing. */
  startedAt?: string;
  /** ISO-8601 UTC time the step completed. */
  completedAt?: string;
  /** ISO-8601 UTC time of the last step transition. */
  updatedAt: string;
}

/** The typed remediation plan returned to the client. */
export interface RemediationPlanDto {
  /** Stable plan id. */
  id: RemediationPlanId;
  /** The problem the plan remediates (tenant-scoped). */
  problemId: string;
  /** The problem the plan remediates (full DTO — investigation included). */
  problem: BusinessProblemDto;
  /** The tenant (organization) scope. */
  tenantId: string;
  /** The verified workspace scope, when present. */
  workspaceId?: string;
  /** The agent that derived and will execute the plan. */
  agentId: string;
  /** The effective business role id. */
  roleId: string;
  /** A human-readable plan title. */
  title: string;
  /** The plan objective (grounded in the known solution). */
  objective: string;
  /** The plan lifecycle. */
  status: RemediationPlanStatus;
  /** The plan version (increments on each replan). */
  version: number;
  /** The number of re-plans performed (bounded). */
  replanCount: number;
  /** The solution candidate id the plan is grounded in, when any. */
  groundedSolutionId?: string;
  /** An explicit reason (blocked/failed/cancelled). */
  reason?: string;
  /** The plan steps, in sequence order. */
  steps: readonly PlanStepDto[];
  /** The final outcome, when the plan completed. */
  outcome?: RemediationOutcomeDto;
  /** ISO-8601 UTC creation time. */
  createdAt: string;
  /** ISO-8601 UTC last transition time. */
  updatedAt: string;
  /** ISO-8601 UTC completion time, when terminal. */
  completedAt?: string;
}

/** The persisted plan record (one row in `remediation_plans`). */
export interface RemediationPlanRecord {
  /** Stable plan id. */
  id: RemediationPlanId;
  /** The remediated problem id. */
  problemId: string;
  /** The tenant (organization) scope. */
  tenantId: string;
  /** The verified workspace scope, when present. */
  workspaceId?: string;
  /** The deriving agent id. */
  agentId: string;
  /** The effective business role id. */
  roleId: string;
  /** Human-readable plan title. */
  title: string;
  /** The plan objective. */
  objective: string;
  /** The plan lifecycle. */
  status: RemediationPlanStatus;
  /** The plan version. */
  version: number;
  /** The re-plan count (bounded). */
  replanCount: number;
  /** The grounded solution candidate id, when any. */
  groundedSolutionId?: string;
  /** An explicit reason (blocked/failed/cancelled). */
  reason?: string;
  /** The final outcome, when completed. */
  outcome?: RemediationOutcomeDto;
  /** ISO-8601 UTC creation time. */
  createdAt: string;
  /** ISO-8601 UTC last transition time. */
  updatedAt: string;
  /** ISO-8601 UTC completion time, when terminal. */
  completedAt?: string;
}

/** The persisted step record (one row in `remediation_plan_steps`). */
export interface RemediationStepRecord {
  /** Stable step id. */
  id: RemediationStepId;
  /** The owning plan id. */
  planId: RemediationPlanId;
  /** 1-based execution order. */
  sequence: number;
  /** Human-readable action label. */
  action: string;
  /** The required capability id. */
  capabilityId: string;
  /** What the step does. */
  description: string;
  /** Why the step is needed. */
  rationale: string;
  /** Step ids this step depends on. */
  dependencies: readonly RemediationStepId[];
  /** The derived approval requirement. */
  approvalRequirement: PlanApprovalRequirement;
  /** The server-derived approver role, when approval is required. */
  requiredApproverRoleId?: string;
  /** How success is verified. */
  verificationRequirement: string;
  /** The step lifecycle. */
  status: PlanStepStatus;
  /** The display-safe result. */
  result?: unknown;
  /** Display-safe verification notes. */
  evidence?: readonly string[];
  /** The recorded approval request id, when opened. */
  approvalId?: string;
  /** ISO-8601 UTC execution start. */
  startedAt?: string;
  /** ISO-8601 UTC completion. */
  completedAt?: string;
  /** ISO-8601 UTC last transition. */
  updatedAt: string;
}

/** A request to create a remediation plan for a problem. */
export interface CreateRemediationPlanRequest {
  /** The problem id (must belong to the caller's tenant/workspace scope). */
  problemId: string;
  /**
   * The solution candidate id to ground the plan in (optional). When
   * omitted, the engine grounds the plan in the problem's top APPLICABLE
   * solution. A client-supplied solution id is honored ONLY when it is one
   * of the problem's own candidates AND applicable (server-side — a forged
   * solution id resolves to no-solution).
   */
  solutionId?: string;
}

/** The outcome of creating a remediation plan. */
export type CreateRemediationPlanResult =
  | { ok: true; plan: RemediationPlanDto }
  | {
      ok: false;
      reason:
        | 'no-role'
        | 'no-agent'
        | 'no-problem'
        | 'no-solution'
        | 'problem-resolved'
        | 'not-configured';
    };

/** The outcome of advancing a remediation plan (execute the next step). */
export type AdvanceRemediationPlanResult =
  | {
      ok: true;
      plan: RemediationPlanDto;
      /** The step the advance acted on (executed or awaiting approval). */
      stepId: RemediationStepId;
      /** The governed execution outcome, when a step executed. */
      outcome?: AgentExecutionOutcome;
    }
  | {
      ok: false;
      reason:
        | 'no-plan'
        | 'not-runnable'
        | 'no-agent'
        | 'capability-escalation'
        | 'not-configured'
        | 'approval-rejected';
    };

/** The outcome of re-planning a remediation plan. */
export type ReplanRemediationPlanResult =
  | { ok: true; plan: RemediationPlanDto }
  | { ok: false; reason: 'no-plan' | 'not-replannable' | 'replan-limit' | 'no-solution' };

/** The outcome of cancelling a remediation plan. */
export type CancelRemediationPlanResult =
  { ok: true; plan: RemediationPlanDto } | { ok: false; reason: 'no-plan' | 'not-cancellable' };
