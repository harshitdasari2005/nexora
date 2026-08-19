/**
 * @nexora/module-remediation — RemediationPlan + PlanStep (Phase 10).
 *
 * The typed plan aggregate: the dynamic, server-validated derivation of a
 * detected problem's applicable known solution + the caller's agent
 * capability set. A plan is NOT a hard-coded workflow — it is derived
 * deterministically per problem (see the plan builder) and validated by the
 * server before it can enter execution. Steps execute ONE AT A TIME through
 * the existing governed execution path; the lifecycle transitions below are
 * the engine's deterministic state machine (never LLM-decided).
 *
 * Bounds are explicit and enforced by the engine: max steps, max replans,
 * max duration, no auto-retry. The plan never loops autonomously — hitting
 * a bound stops and requires human intervention.
 */

import type {
  PlanApprovalRequirement,
  PlanStepStatus,
  RemediationOutcomeDto,
  RemediationPlanStatus,
  RemediationPlanRecord,
  RemediationStepRecord,
} from '@nexora/contracts/remediation';

/** The plan lifecycle transition table (deterministic, explicit). */
const PLAN_TRANSITIONS: Readonly<Record<RemediationPlanStatus, readonly RemediationPlanStatus[]>> =
  {
    DRAFT: ['VALIDATED', 'BLOCKED', 'CANCELLED'],
    VALIDATED: ['AWAITING_APPROVAL', 'READY', 'CANCELLED'],
    AWAITING_APPROVAL: ['EXECUTING', 'REPLANNING', 'CANCELLED', 'FAILED', 'BLOCKED'],
    READY: ['EXECUTING', 'REPLANNING', 'CANCELLED', 'FAILED', 'BLOCKED'],
    EXECUTING: [
      'AWAITING_APPROVAL',
      'REPLANNING',
      'COMPLETED',
      'FAILED',
      'BLOCKED',
      'CANCELLED',
      'PAUSED',
    ],
    PAUSED: ['EXECUTING', 'REPLANNING', 'CANCELLED', 'FAILED'],
    REPLANNING: ['DRAFT', 'FAILED'],
    COMPLETED: [],
    FAILED: [],
    CANCELLED: [],
    BLOCKED: ['REPLANNING', 'CANCELLED', 'FAILED'],
  };

/** The step lifecycle transition table (deterministic, explicit). */
const STEP_TRANSITIONS: Readonly<Record<PlanStepStatus, readonly PlanStepStatus[]>> = {
  PENDING: ['AWAITING_APPROVAL', 'RUNNING', 'SKIPPED', 'BLOCKED', 'FAILED'],
  AWAITING_APPROVAL: ['RUNNING', 'FAILED', 'BLOCKED'],
  RUNNING: ['VERIFIED', 'FAILED', 'BLOCKED'],
  VERIFIED: [],
  BLOCKED: ['RUNNING'],
  FAILED: [],
  SKIPPED: [],
};

/** The identity + lifecycle of one remediation plan. */
export interface RemediationPlanSnapshot {
  id: string;
  problemId: string;
  tenantId: string;
  workspaceId?: string;
  agentId: string;
  roleId: string;
  title: string;
  objective: string;
  status: RemediationPlanStatus;
  version: number;
  replanCount: number;
  groundedSolutionId?: string;
  reason?: string;
  outcome?: RemediationOutcomeDto;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
}

/** The identity + lifecycle of one plan step. */
export interface PlanStepSnapshot {
  id: string;
  planId: string;
  sequence: number;
  action: string;
  capabilityId: string;
  description: string;
  rationale: string;
  dependencies: readonly string[];
  approvalRequirement: PlanApprovalRequirement;
  requiredApproverRoleId?: string;
  verificationRequirement: string;
  status: PlanStepStatus;
  result?: unknown;
  evidence?: readonly string[];
  approvalId?: string;
  startedAt?: string;
  completedAt?: string;
  updatedAt: string;
}

/** A deterministic lifecycle violation. */
export class RemediationStateTransitionError extends Error {
  constructor(input: { id: string; from: string; to: string }) {
    super(`Plan ${input.id} cannot transition ${input.from} → ${input.to}`);
    this.name = 'RemediationStateTransitionError';
  }
}

/** The {@link RemediationPlan} aggregate root. */
export class RemediationPlan {
  readonly #snapshot: RemediationPlanSnapshot;

  private constructor(snapshot: RemediationPlanSnapshot) {
    this.#snapshot = { ...snapshot };
  }

  /** Creates a new plan in `DRAFT` (version 1, no replans). */
  static create(input: {
    id: string;
    problemId: string;
    tenantId: string;
    workspaceId?: string;
    agentId: string;
    roleId: string;
    title: string;
    objective: string;
    groundedSolutionId?: string;
    createdAt: string;
  }): RemediationPlan {
    return new RemediationPlan({
      ...input,
      status: 'DRAFT',
      version: 1,
      replanCount: 0,
      updatedAt: input.createdAt,
    });
  }

  /** Reconstructs a plan from a persisted snapshot. */
  static hydrate(snapshot: RemediationPlanSnapshot): RemediationPlan {
    return new RemediationPlan(snapshot);
  }

  /** Plan id. */
  get id(): string {
    return this.#snapshot.id;
  }

  /** The remediated problem id. */
  get problemId(): string {
    return this.#snapshot.problemId;
  }

  /** Tenant scope. */
  get tenantId(): string {
    return this.#snapshot.tenantId;
  }

  /** Workspace scope, when set. */
  get workspaceId(): string | undefined {
    return this.#snapshot.workspaceId;
  }

  /** The plan lifecycle. */
  get status(): RemediationPlanStatus {
    return this.#snapshot.status;
  }

  /** The plan version (increments per replan). */
  get version(): number {
    return this.#snapshot.version;
  }

  /** The re-plan count (bounded). */
  get replanCount(): number {
    return this.#snapshot.replanCount;
  }

  /** The grounding solution candidate id. */
  get groundedSolutionId(): string | undefined {
    return this.#snapshot.groundedSolutionId;
  }

  /** The plan creation time. */
  get createdAt(): string {
    return this.#snapshot.createdAt;
  }

  /** The last transition time. */
  get updatedAt(): string {
    return this.#snapshot.updatedAt;
  }

  /** Whether the plan is in a terminal state. */
  isTerminal(): boolean {
    return (
      this.#snapshot.status === 'COMPLETED' ||
      this.#snapshot.status === 'FAILED' ||
      this.#snapshot.status === 'CANCELLED'
    );
  }

  /** Whether the plan is in an executable state (a step may run). */
  isExecutable(): boolean {
    return (
      this.#snapshot.status === 'READY' ||
      this.#snapshot.status === 'EXECUTING' ||
      this.#snapshot.status === 'AWAITING_APPROVAL'
    );
  }

  /** Transitions the lifecycle (deterministic transition table). */
  transitionTo(status: RemediationPlanStatus, now: string): void {
    const allowed = PLAN_TRANSITIONS[this.#snapshot.status];
    if (allowed === undefined || !allowed.includes(status)) {
      throw new RemediationStateTransitionError({
        id: this.#snapshot.id,
        from: this.#snapshot.status,
        to: status,
      });
    }
    this.#snapshot.status = status;
    this.#snapshot.updatedAt = now;
    if (status === 'COMPLETED' || status === 'FAILED' || status === 'CANCELLED') {
      this.#snapshot.completedAt = now;
    }
  }

  /** Records an explicit reason (blocked/failed/cancelled). */
  setReason(reason: string | undefined, now: string): void {
    this.#snapshot.reason = reason;
    this.#snapshot.updatedAt = now;
  }

  /** Records the final outcome (completed only). */
  setOutcome(outcome: RemediationOutcomeDto, now: string): void {
    this.#snapshot.outcome = outcome;
    this.#snapshot.updatedAt = now;
  }

  /** Bumps the version (replan) and returns to `DRAFT`. */
  reopenForReplan(now: string): void {
    this.#snapshot.version += 1;
    this.#snapshot.replanCount += 1;
    this.#snapshot.status = 'DRAFT';
    this.#snapshot.reason = undefined;
    this.#snapshot.outcome = undefined;
    this.#snapshot.completedAt = undefined;
    this.#snapshot.updatedAt = now;
  }

  /** Produces the persistence snapshot. */
  snapshot(): RemediationPlanSnapshot {
    return { ...this.#snapshot };
  }

  /** Produces the persisted record. */
  record(): RemediationPlanRecord {
    return { ...this.#snapshot };
  }
}

/** The {@link PlanStep} aggregate root (owned by a plan). */
export class PlanStep {
  readonly #snapshot: PlanStepSnapshot;

  private constructor(snapshot: PlanStepSnapshot) {
    this.#snapshot = { ...snapshot };
  }

  /** Creates a new step in `PENDING`. */
  static create(input: {
    id: string;
    planId: string;
    sequence: number;
    action: string;
    capabilityId: string;
    description: string;
    rationale: string;
    dependencies: readonly string[];
    approvalRequirement: PlanApprovalRequirement;
    requiredApproverRoleId?: string;
    verificationRequirement: string;
    createdAt: string;
  }): PlanStep {
    return new PlanStep({
      ...input,
      status: 'PENDING',
      updatedAt: input.createdAt,
    });
  }

  /** Reconstructs a step from a persisted snapshot. */
  static hydrate(snapshot: PlanStepSnapshot): PlanStep {
    return new PlanStep(snapshot);
  }

  /** Step id. */
  get id(): string {
    return this.#snapshot.id;
  }

  /** The owning plan id. */
  get planId(): string {
    return this.#snapshot.planId;
  }

  /** 1-based execution order. */
  get sequence(): number {
    return this.#snapshot.sequence;
  }

  /** The required capability id. */
  get capabilityId(): string {
    return this.#snapshot.capabilityId;
  }

  /** The step lifecycle. */
  get status(): PlanStepStatus {
    return this.#snapshot.status;
  }

  /** The derived approval requirement. */
  get approvalRequirement(): PlanApprovalRequirement {
    return this.#snapshot.approvalRequirement;
  }

  /** The server-derived approver role. */
  get requiredApproverRoleId(): string | undefined {
    return this.#snapshot.requiredApproverRoleId;
  }

  /** The recorded approval request id, when opened. */
  get approvalId(): string | undefined {
    return this.#snapshot.approvalId;
  }

  /** Whether the step may be claimed for execution (exactly-once). */
  isClaimable(): boolean {
    return this.#snapshot.status === 'PENDING' || this.#snapshot.status === 'AWAITING_APPROVAL';
  }

  /** Transitions the lifecycle (deterministic transition table). */
  transitionTo(status: PlanStepStatus, now: string): void {
    const allowed = STEP_TRANSITIONS[this.#snapshot.status];
    if (allowed === undefined || !allowed.includes(status)) {
      throw new RemediationStateTransitionError({
        id: this.#snapshot.id,
        from: this.#snapshot.status,
        to: status,
      });
    }
    this.#snapshot.status = status;
    this.#snapshot.updatedAt = now;
    if (status === 'RUNNING') {
      this.#snapshot.startedAt = now;
    }
    if (status === 'VERIFIED' || status === 'FAILED') {
      this.#snapshot.completedAt = now;
    }
  }

  /** Marks the step awaiting approval and records the approval request. */
  markAwaitingApproval(approvalId: string, now: string): void {
    const allowed = STEP_TRANSITIONS[this.#snapshot.status];
    if (allowed === undefined || !allowed.includes('AWAITING_APPROVAL')) {
      throw new RemediationStateTransitionError({
        id: this.#snapshot.id,
        from: this.#snapshot.status,
        to: 'AWAITING_APPROVAL',
      });
    }
    this.#snapshot.status = 'AWAITING_APPROVAL';
    this.#snapshot.approvalId = approvalId;
    this.#snapshot.updatedAt = now;
  }

  /** Records the display-safe result + verification evidence of a completed step. */
  recordResult(input: { result?: unknown; evidence?: readonly string[] }, now: string): void {
    this.#snapshot.result = input.result;
    this.#snapshot.evidence = input.evidence ?? [];
    this.#snapshot.updatedAt = now;
  }

  /** Produces the persistence snapshot. */
  snapshot(): PlanStepSnapshot {
    return { ...this.#snapshot };
  }

  /** Produces the persisted record. */
  record(): RemediationStepRecord {
    return { ...this.#snapshot };
  }
}
