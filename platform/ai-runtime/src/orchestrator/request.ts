/**
 * @nexora/ai-runtime — orchestrator request/response.
 *
 * The EAO's public input and output contracts (AIR.md §2). Requests carry
 * the utterance plus the run scope; responses carry the outcome narrative,
 * the executed steps, and the decision-time explanation (ADR-011).
 */

import type { AutonomyTier } from '@nexora/contracts/ai';
import type { ExecutionPlan } from '../planner/plan.js';
import type { DecisionRecord } from '../reasoning/index.js';
import type { ExecutionTrace } from '../telemetry/telemetry.js';

/** A request into the orchestrator (AOE-1 intent intake). */
export interface OrchestratorRequest {
  /** The user utterance / task description. */
  utterance: string;
  /** The invoking user id. */
  userId: string;
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
  /** Whether the result was verified (AI-6). */
  verified: boolean;
}

/** An approval gate outcome. */
export interface ApprovalOutcome {
  /** The step id the gate guarded. */
  stepId: string;
  /** The tool id the gate guarded. */
  toolId: string;
  /** The gate disposition. */
  status: 'granted' | 'pending' | 'rejected';
  /** The side-effect class that triggered the gate. */
  sideEffectClass: string;
  /** The recorded approval request id, when the runtime tracks approvals. */
  id?: string;
  /** The capability id the gate guarded (card context). */
  capabilityId?: string;
  /** The user-controlled action input (card context; never identity). */
  input?: Record<string, unknown>;
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
}
