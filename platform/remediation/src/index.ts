/**
 * @nexora/module-remediation — public surface (Phase 10).
 *
 * The GENERIC governed remediation engine: from a detected problem with an
 * applicable known solution, it derives a DYNAMIC plan (one step per
 * required capability, bounded), VALIDATES it server-side (VALID or BLOCKED
 * + reason), ROUTES approvals (who should approve — derived from capability
 * policy, never the client), and executes one step at a time through the
 * EXISTING governed execution path (S26 AgentExecutionPort → AI Runtime →
 * ToolExecutor → ApprovalEngine → verification → decision records →
 * journal). After every step the engine re-evaluates the problem
 * deterministically and decides next step / replan / complete / stop —
 * with explicit bounds (steps, replans, duration). There is no second
 * execution engine, no second approval system, no autonomous agent.
 *
 * Security contract (Phase 10): the engine resolves tenant/workspace/role/
 * capability/approver from trusted context + ports ONLY. Forged plan/
 * problem/step/solution ids resolve to nothing; a step whose capability is
 * outside the caller's CURRENT agent set is rejected; approval decisions
 * flow through the existing ApprovalEngine and are never influenced by the
 * request. The client is authoritative for NOTHING.
 */

export {
  DefaultApprovalRoutingPolicy,
  DEFAULT_APPROVAL_ROUTING,
  DEFAULT_APPROVER_ROLE_ID,
  type ApprovalRoutingDecision,
  type ApprovalRoutingEntry,
  type ApprovalRoutingPolicy,
} from './application/approval-routing.js';
export {
  MAX_PLAN_STEPS,
  PlanBuilder,
  stepToDto,
  type PlanBlueprint,
  type PlanBuilderInput,
} from './application/plan-builder.js';
export { InMemoryPlanStore, type PlanStore } from './application/plan-store.js';
export {
  AdvanceRemediationPlanHandler,
  CancelRemediationPlanHandler,
  CreateRemediationPlanHandler,
  GetRemediationPlanHandler,
  ListRemediationPlansHandler,
  MAX_PLAN_DURATION_MS,
  MAX_REPLANS,
  PLANS_LIMIT,
  RemediationApplicationService,
  ReplanRemediationPlanHandler,
  type RemediationApplicationServiceDependencies,
} from './application/remediation-application-service.js';
export {
  type RemediationAgent,
  type RemediationAgentResolver,
  type RemediationApprovalEngine,
  type RemediationCapabilityMetadata,
  type RemediationCapabilityProvider,
  type RemediationContext,
  type RemediationExecutionPort,
  type RemediationExecutionRecorder,
  type RemediationProblemLifecyclePort,
  type RemediationProblemProvider,
  type RemediationProblemReevaluator,
} from './application/remediation-ports.js';
export {
  PlanStep,
  RemediationPlan,
  RemediationStateTransitionError,
  type PlanStepSnapshot,
  type RemediationPlanSnapshot,
} from './domain/plan.js';
