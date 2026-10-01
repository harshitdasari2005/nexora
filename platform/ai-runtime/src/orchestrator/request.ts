/**
 * @nexora/ai-runtime — orchestrator request/response.
 *
 * The EAO's public input and output contracts (AIR.md §2). Requests carry
 * the utterance plus the run scope; responses carry the outcome narrative,
 * the executed steps, and the decision-time explanation (ADR-011).
 */

import type { AgentPrincipalContext } from '@nexora/contracts/agent';
import type { AutonomyTier } from '@nexora/contracts/ai';
import type { AIBusinessContext } from '../context/index.js';
import type { ExecutionPlan } from '../planner/plan.js';
import type { DecisionRecord } from '../reasoning/index.js';
import type { ExecutionTrace } from '../telemetry/telemetry.js';

/** A request into the orchestrator (AOE-1 intent intake). */
export interface OrchestratorRequest {
  /** The user utterance / task description. */
  utterance: string;
  /** The invoking user id. */
  userId: string;
  /**
   * The HTTP request id that started this run (Prompt 7 correlation). An id
   * for tracing only: it is never read by any authorization, policy or
   * approval decision.
   */
  requestId?: string;
  /**
   * Where the run came from, for observability only (`remediation` for the
   * remediation engine). Descriptive: never read by any authorization decision.
   */
  runOrigin?: 'remediation';
  /** The tenant (company) id. */
  tenantId: string;
  /** The workspace id, when workspace-scoped. */
  workspaceId?: string;
  /** The conversation id, to continue an existing conversation. */
  conversationId?: string;
  /**
   * Reserved autonomy tier for policy-driven flows. **Not honored by the
   * orchestrator**: the tier is derived from platform configuration only
   * (`ai.runtime.autonomyTier`, default `supervised`) so a caller can never
   * self-elevate to a tier that skips state-change approval.
   */
  autonomyTier?: AutonomyTier;
  /** Capability allow-list (e.g. command-palette driven); empty = discover all. */
  allowedCapabilityIds?: readonly string[];
  /**
   * The trusted business context (domain/role/capability affinity), resolved
   * server-side from membership + the Phase 1 catalog. CONTEXT, not
   * authorization: it focuses discovery on the role's relevant capabilities
   * but never widens access — the model can never supply this value.
   */
  businessContext?: AIBusinessContext;
  /** Whether approval gates are treated as granted (test/dev harness only). */
  autoApprove?: boolean;
  /**
   * Resume an approval-gated run after a recorded server-side decision. The
   * value is a server-resolved approval id — never caller-supplied identity:
   * the approval engine validates ownership (user + tenant + conversation)
   * before any gate is granted. When present, the orchestrator does not
   * duplicate the user turn and records the decision as a system turn.
   */
  approvalId?: string;
  /**
   * The TRUSTED agent principal this run executes as (Prompt 4). Set ONLY
   * by server code that resolved a persisted, active agent identity inside
   * the run's organization + workspace — never from a request body, tool
   * argument, or model output. Every tool invocation of the run is then
   * re-authorized against the agent's delegations at execution time, and
   * approvals it opens are bound to it.
   */
  agent?: AgentPrincipalContext;
}

/** The outcome of one executed plan step. */
export interface StepOutcome {
  /** The step id. */
  stepId: string;
  /** The capability executed. */
  capabilityId: string;
  /** The tool invoked. */
  toolId: string;
  /** The step outcome. */
  status: 'succeeded' | 'failed' | 'blocked' | 'skipped';
  /** The output on success. */
  output?: unknown;
  /** The failure/block reason. */
  error?: string;
  /**
   * The stable machine code of a failure (e.g. `DELEGATION_EXPIRED`,
   * `RESERVED_ARGUMENT`) — a policy/reason code only, never argument values.
   */
  errorCode?: string;
  /**
   * A tool-vetted, user-presentable statement about a failed step (e.g. the
   * rollback outcome). Safe to show — unlike `error`, which stays out of the
   * response.
   */
  detail?: string;
  /** Whether the result was verified (AI-6). */
  verified: boolean;
  /** The delegation that authorized the step, when it ran as an agent (Prompt 4). */
  delegationId?: string;
}

/** An approval gate outcome. */
export interface ApprovalOutcome {
  /** The step id the gate guarded. */
  stepId: string;
  /** The tool id the gate guarded. */
  toolId: string;
  /** The gate disposition. */
  status: 'granted' | 'pending' | 'rejected' | 'expired';
  /** The side-effect class that triggered the gate. */
  sideEffectClass: string;
  /** The recorded approval request id, when the runtime tracks approvals. */
  id?: string;
  /** The capability id the gate guarded (card context). */
  capabilityId?: string;
  /** The user-controlled action input (card context; never identity). */
  input?: Record<string, unknown>;
  /** ISO-8601 expiry of the recorded approval (present with `id`). */
  expiresAt?: string;
  /** The role a decider must hold, when the policy requires one. */
  requiredApproverRoleId?: string;
  /** Whether the decider must differ from the requester (present with `id`). */
  separationOfDuties?: boolean;
}

/** The run status. */
export type OrchestratorRunStatus = 'completed' | 'clarification' | 'blocked' | 'failed';

/** The orchestrator's response to a request. */
export interface OrchestratorResponse {
  /** Run id. */
  runId: string;
  /** The conversation id the run belongs to. */
  conversationId: string;
  /** The run status. */
  status: OrchestratorRunStatus;
  /** The composed response narrative (FR-6 narration). */
  response: string;
  /** The user intent as understood. */
  intent: string;
  /** The executed plan, when one was committed. */
  plan?: ExecutionPlan;
  /** Per-step outcomes, in execution order. */
  steps: readonly StepOutcome[];
  /** Approval gate outcomes. */
  approvals: readonly ApprovalOutcome[];
  /** The decision-time record (ADR-011). */
  decision: DecisionRecord;
  /** The execution trace. */
  trace: ExecutionTrace;
  /**
   * The retrieved sources the narration was given (Prompt 6): structured
   * provenance — which exact source objects (and versions) the results the
   * answer rests on came from. It is a description of what was in the
   * results, not a claim-to-source proof, and never an input to any decision.
   */
  sources?: readonly NarratedSource[];
  /**
   * The stable failure code of a failure that belongs to no single step
   * (e.g. `APPROVAL_NOT_BOUND`: a resumed approval no step consumed). Used
   * for telemetry classification; absent when the failure is a step's own.
   */
  failureCode?: string;
}

/** One retrieved source the narration had available. */
export interface NarratedSource {
  /** The step whose tool result carried it. */
  stepId: string;
  toolId: string;
  sourceId: string;
  kind?: string;
  version?: number;
  title?: string;
}
