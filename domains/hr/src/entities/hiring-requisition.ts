/**
 * @nexora/domain-hr — HiringRequisition aggregate root.
 *
 * A request to hire, raised by the team that needs the person and decided by
 * a chain of different people — the way a real office does it:
 *
 *   requester submits ──► executive decides ──► finance decides ──► approved
 *                              │                     │              (HR takes over)
 *                              └──── reject ─────────┘
 *                                       ▼
 *                               changes_requested ──► requester revises ──► (chain restarts)
 *
 * The aggregate owns the rules that make the chain trustworthy:
 * - a stage can only be decided while the requisition is waiting at it;
 * - nobody decides their own request (separation of duties);
 * - nobody decides two stages of the same round;
 * - a rejection must say why, and sends the request back to the requester;
 * - only the requester may revise or withdraw.
 *
 * WHO holds the authority to decide a stage is not decided here — that is the
 * caller's role (RBAC), checked before the aggregate is asked. When the
 * requester already holds the executive authority, the executive stage is
 * skipped (a request raised by the chief executive needs no executive
 * sign-off) and the request waits for Finance directly.
 */

import type { EventEnvelope } from '@nexora/shared/events';
import { nowIso } from '@nexora/shared/time';
import type { TenantId, WorkspaceId } from '@nexora/contracts/common';

import {
  InvalidEmployeeValueError,
  RequisitionNotPermittedError,
  RequisitionStateError,
} from '../errors/index.js';
import {
  requisitionEvent,
  REQUISITION_EVENT_TYPES,
  type RequisitionEventContext,
} from '../events/requisition-events.js';
import { RequisitionId } from '../value-objects/requisition-id.js';

/** The lifecycle states of a hiring requisition. */
export const REQUISITION_STATUSES = [
  'pending_executive',
  'pending_finance',
  'approved',
  'changes_requested',
  'withdrawn',
] as const;
export type RequisitionStatus = (typeof REQUISITION_STATUSES)[number];

/** The decision stages, in chain order. */
export const REQUISITION_STAGES = ['executive', 'finance'] as const;
export type RequisitionStage = (typeof REQUISITION_STAGES)[number];

/** The status in which each stage is decided. */
const STAGE_STATUS: Record<RequisitionStage, RequisitionStatus> = {
  executive: 'pending_executive',
  finance: 'pending_finance',
};

export const EMPLOYMENT_TYPES = ['full_time', 'part_time', 'contract', 'intern'] as const;
export type EmploymentType = (typeof EMPLOYMENT_TYPES)[number];

export const REQUISITION_URGENCIES = ['low', 'normal', 'high'] as const;
export type RequisitionUrgency = (typeof REQUISITION_URGENCIES)[number];

/** What is being asked for (the part the requester fills in and may revise). */
export interface RequisitionDetails {
  /** The role to hire for, e.g. "Senior Backend Developer". */
  jobTitle: string;
  /** The team / department that needs the person. */
  department: string;
  /** The project the hire is intended for, when there is one. */
  projectId?: string;
  /** How many people (1–50). */
  headcount: number;
  employmentType: EmploymentType;
  /** Salary range per person per year, in minor units of `currency`. */
  salaryMinMinorUnits: number;
  salaryMaxMinorUnits: number;
  /** ISO-4217 currency code. */
  currency: string;
  /** Why the team needs this hire. */
  justification: string;
  urgency: RequisitionUrgency;
  /** Desired start date (`YYYY-MM-DD`), when known. */
  targetStartDate?: string;
}

/** One recorded step of the requisition's history (append-only). */
export interface RequisitionHistoryEntry {
  /** ISO-8601 UTC time. */
  at: string;
  /** The user who took the step. */
  actorId: string;
  action:
    'submitted' | 'executive_not_required' | 'approved' | 'rejected' | 'resubmitted' | 'withdrawn';
  /** The stage the step belongs to (decisions only). */
  stage?: RequisitionStage;
  /** The actor's comment (required on a rejection). */
  comment?: string;
  /** The submission round the step belongs to (1 = first submission). */
  round: number;
}

/** Input for raising a requisition. */
export interface SubmitRequisitionInput extends RequisitionDetails {
  organizationId: TenantId;
  /** The workspace (team) the request is raised from. */
  workspaceId: WorkspaceId;
  /** The requesting user. */
  requestedBy: string;
  /** Whether the requester already holds the executive decision authority. */
  requesterIsExecutive: boolean;
}

/** A persistence snapshot of the {@link HiringRequisition}. */
export interface HiringRequisitionSnapshot extends RequisitionDetails {
  id: RequisitionId;
  organizationId: TenantId;
  workspaceId: WorkspaceId;
  requestedBy: string;
  status: RequisitionStatus;
  /** The current submission round (starts at 1, +1 on every resubmission). */
  round: number;
  history: readonly RequisitionHistoryEntry[];
  createdAt: string;
  updatedAt: string;
  /** Monotonic version for optimistic concurrency. */
  version: number;
}

const MAX_SALARY_MINOR_UNITS = 100_000_000_000;
const MAX_COMMENT_LENGTH = 1000;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** Validates and normalizes the requester-supplied details. */
function normalizeDetails(input: RequisitionDetails): RequisitionDetails {
  const issues: { path: string; message: string }[] = [];
  const jobTitle = typeof input.jobTitle === 'string' ? input.jobTitle.trim() : '';
  const department = typeof input.department === 'string' ? input.department.trim() : '';
  const justification = typeof input.justification === 'string' ? input.justification.trim() : '';
  const currency = typeof input.currency === 'string' ? input.currency.trim().toUpperCase() : '';
  if (jobTitle.length < 2 || jobTitle.length > 120) {
    issues.push({ path: 'jobTitle', message: 'Must be 2–120 characters' });
  }
  if (department.length < 1 || department.length > 80) {
    issues.push({ path: 'department', message: 'Must be 1–80 characters' });
  }
  if (!Number.isInteger(input.headcount) || input.headcount < 1 || input.headcount > 50) {
    issues.push({ path: 'headcount', message: 'Must be a whole number from 1 to 50' });
  }
  if (!EMPLOYMENT_TYPES.includes(input.employmentType)) {
    issues.push({
      path: 'employmentType',
      message: `Must be one of: ${EMPLOYMENT_TYPES.join(', ')}`,
    });
  }
  const salaryOk = (value: number): boolean =>
    Number.isInteger(value) && value >= 0 && value <= MAX_SALARY_MINOR_UNITS;
  if (!salaryOk(input.salaryMinMinorUnits)) {
    issues.push({ path: 'salaryMinMinorUnits', message: 'Must be a non-negative whole amount' });
  }
  if (!salaryOk(input.salaryMaxMinorUnits)) {
    issues.push({ path: 'salaryMaxMinorUnits', message: 'Must be a non-negative whole amount' });
  } else if (
    salaryOk(input.salaryMinMinorUnits) &&
    input.salaryMaxMinorUnits < input.salaryMinMinorUnits
  ) {
    issues.push({ path: 'salaryMaxMinorUnits', message: 'Must not be below the minimum salary' });
  }
  if (!/^[A-Z]{3}$/.test(currency)) {
    issues.push({ path: 'currency', message: 'Must be a 3-letter currency code' });
  }
  if (justification.length < 10 || justification.length > 2000) {
    issues.push({ path: 'justification', message: 'Must be 10–2000 characters' });
  }
  if (!REQUISITION_URGENCIES.includes(input.urgency)) {
    issues.push({
      path: 'urgency',
      message: `Must be one of: ${REQUISITION_URGENCIES.join(', ')}`,
    });
  }
  if (input.targetStartDate !== undefined) {
    const valid =
      DATE_PATTERN.test(input.targetStartDate) &&
      !Number.isNaN(Date.parse(`${input.targetStartDate}T00:00:00.000Z`));
    if (!valid) {
      issues.push({ path: 'targetStartDate', message: 'Must be a date (YYYY-MM-DD)' });
    }
  }
  if (
    input.projectId !== undefined &&
    (typeof input.projectId !== 'string' ||
      input.projectId.length < 1 ||
      input.projectId.length > 64)
  ) {
    issues.push({ path: 'projectId', message: 'Must be a project id' });
  }
  if (issues.length > 0) {
    throw new InvalidEmployeeValueError('Invalid hiring request', issues);
  }
  return {
    jobTitle,
    department,
    ...(input.projectId === undefined ? {} : { projectId: input.projectId }),
    headcount: input.headcount,
    employmentType: input.employmentType,
    salaryMinMinorUnits: input.salaryMinMinorUnits,
    salaryMaxMinorUnits: input.salaryMaxMinorUnits,
    currency,
    justification,
    urgency: input.urgency,
    ...(input.targetStartDate === undefined ? {} : { targetStartDate: input.targetStartDate }),
  };
}

/** Normalizes an optional comment (trimmed; empty → absent). */
function normalizeComment(comment: string | undefined): string | undefined {
  if (comment === undefined) return undefined;
  const trimmed = comment.trim();
  if (trimmed.length > MAX_COMMENT_LENGTH) {
    throw new InvalidEmployeeValueError('Invalid comment', [
      { path: 'comment', message: `Must be at most ${MAX_COMMENT_LENGTH} characters` },
    ]);
  }
  return trimmed.length === 0 ? undefined : trimmed;
}

/**
 * The {@link HiringRequisition} aggregate root. Construct with
 * {@link HiringRequisition.submit}; change only through its methods.
 */
export class HiringRequisition {
  #id: RequisitionId;
  readonly #organizationId: TenantId;
  readonly #workspaceId: WorkspaceId;
  readonly #requestedBy: string;
  #details: RequisitionDetails;
  #status: RequisitionStatus;
  #round: number;
  #history: RequisitionHistoryEntry[];
  readonly #createdAt: string;
  #updatedAt: string;
  #version: number;
  readonly #events: EventEnvelope[] = [];

  private constructor(snapshot: HiringRequisitionSnapshot) {
    this.#id = snapshot.id;
    this.#organizationId = snapshot.organizationId;
    this.#workspaceId = snapshot.workspaceId;
    this.#requestedBy = snapshot.requestedBy;
    this.#details = detailsOf(snapshot);
    this.#status = snapshot.status;
    this.#round = snapshot.round;
    this.#history = [...snapshot.history];
    this.#createdAt = snapshot.createdAt;
    this.#updatedAt = snapshot.updatedAt;
    this.#version = snapshot.version;
  }

  /**
   * Raises a new requisition. It waits for the executive decision — unless the
   * requester already holds that authority, in which case it waits for Finance.
   */
  static submit(
    input: SubmitRequisitionInput,
    context: RequisitionEventContext,
    now = nowIso(),
  ): HiringRequisition {
    const details = normalizeDetails(input);
    const history: RequisitionHistoryEntry[] = [
      { at: now, actorId: input.requestedBy, action: 'submitted', round: 1 },
    ];
    if (input.requesterIsExecutive) {
      history.push({
        at: now,
        actorId: input.requestedBy,
        action: 'executive_not_required',
        stage: 'executive',
        round: 1,
      });
    }
    const requisition = new HiringRequisition({
      id: RequisitionId.create(),
      organizationId: input.organizationId,
      workspaceId: input.workspaceId,
      requestedBy: input.requestedBy,
      ...details,
      status: input.requesterIsExecutive ? 'pending_finance' : 'pending_executive',
      round: 1,
      history,
      createdAt: now,
      updatedAt: now,
      version: 1,
    });
    requisition.#emit(REQUISITION_EVENT_TYPES.submitted, context);
    return requisition;
  }

  /** Reconstitutes an aggregate from its snapshot (no events, no validation of history). */
  static hydrate(snapshot: HiringRequisitionSnapshot): HiringRequisition {
    if (!REQUISITION_STATUSES.includes(snapshot.status)) {
      throw new InvalidEmployeeValueError('Invalid requisition status', [
        { path: 'status', message: `Must be one of: ${REQUISITION_STATUSES.join(', ')}` },
      ]);
    }
    return new HiringRequisition(snapshot);
  }

  /** The persistence snapshot of an aggregate. */
  static snapshot(requisition: HiringRequisition): HiringRequisitionSnapshot {
    return {
      id: requisition.#id,
      organizationId: requisition.#organizationId,
      workspaceId: requisition.#workspaceId,
      requestedBy: requisition.#requestedBy,
      ...requisition.#details,
      status: requisition.#status,
      round: requisition.#round,
      history: [...requisition.#history],
      createdAt: requisition.#createdAt,
      updatedAt: requisition.#updatedAt,
      version: requisition.#version,
    };
  }

  get id(): RequisitionId {
    return this.#id;
  }
  get organizationId(): TenantId {
    return this.#organizationId;
  }
  get workspaceId(): WorkspaceId {
    return this.#workspaceId;
  }
  get requestedBy(): string {
    return this.#requestedBy;
  }
  get status(): RequisitionStatus {
    return this.#status;
  }
  get round(): number {
    return this.#round;
  }
  get version(): number {
    return this.#version;
  }
  get details(): RequisitionDetails {
    return { ...this.#details };
  }
  get history(): readonly RequisitionHistoryEntry[] {
    return [...this.#history];
  }

  /** The stage the requisition is currently waiting at, if any. */
  get pendingStage(): RequisitionStage | undefined {
    return REQUISITION_STAGES.find((stage) => STAGE_STATUS[stage] === this.#status);
  }

  /**
   * Why `actorId` may not decide `stage` right now, or `undefined` when they
   * may (the caller has already established the actor HOLDS the stage's authority).
   */
  decisionBlocker(stage: RequisitionStage, actorId: string): string | undefined {
    if (this.#status !== STAGE_STATUS[stage]) {
      return `This hiring request is not waiting for the ${stage} decision`;
    }
    if (actorId === this.#requestedBy) {
      return 'You cannot decide your own hiring request';
    }
    const decidedEarlierStage = this.#history.some(
      (entry) =>
        entry.round === this.#round && entry.action === 'approved' && entry.actorId === actorId,
    );
    if (decidedEarlierStage) {
      return 'You already decided an earlier stage of this hiring request';
    }
    return undefined;
  }

  /**
   * Records a stage decision. Approve advances the chain (executive → finance
   * → approved); reject sends the request back to the requester.
   *
   * @throws {RequisitionStateError} when the requisition is not at `stage`.
   * @throws {RequisitionNotPermittedError} on a separation-of-duties violation.
   */
  decide(
    input: {
      stage: RequisitionStage;
      decision: 'approve' | 'reject';
      actorId: string;
      comment?: string;
    },
    context: RequisitionEventContext,
    now = nowIso(),
  ): void {
    if (this.#status !== STAGE_STATUS[input.stage]) {
      throw new RequisitionStateError(
        `This hiring request is not waiting for the ${input.stage} decision`,
        { status: this.#status },
      );
    }
    const blocker = this.decisionBlocker(input.stage, input.actorId);
    if (blocker !== undefined) {
      throw new RequisitionNotPermittedError(blocker);
    }
    const comment = normalizeComment(input.comment);
    if (input.decision === 'reject' && comment === undefined) {
      throw new InvalidEmployeeValueError('A rejection needs a reason', [
        { path: 'comment', message: 'Say what should change so the requester can fix it' },
      ]);
    }
    this.#history.push({
      at: now,
      actorId: input.actorId,
      action: input.decision === 'approve' ? 'approved' : 'rejected',
      stage: input.stage,
      ...(comment === undefined ? {} : { comment }),
      round: this.#round,
    });
    if (input.decision === 'reject') {
      this.#status = 'changes_requested';
      this.#touch(now);
      this.#emit(REQUISITION_EVENT_TYPES.changesRequested, context, { stage: input.stage });
      return;
    }
    this.#status = input.stage === 'executive' ? 'pending_finance' : 'approved';
    this.#touch(now);
    this.#emit(
      this.#status === 'approved'
        ? REQUISITION_EVENT_TYPES.approved
        : REQUISITION_EVENT_TYPES.stageApproved,
      context,
      { stage: input.stage },
    );
  }

  /**
   * The requester revises a returned request and resubmits it: a new round,
   * and the chain starts again.
   */
  revise(
    input: { details: RequisitionDetails; actorId: string; requesterIsExecutive: boolean },
    context: RequisitionEventContext,
    now = nowIso(),
  ): void {
    if (input.actorId !== this.#requestedBy) {
      throw new RequisitionNotPermittedError('Only the requester can revise a hiring request');
    }
    if (this.#status !== 'changes_requested') {
      throw new RequisitionStateError('Only a returned hiring request can be revised', {
        status: this.#status,
      });
    }
    this.#details = normalizeDetails(input.details);
    this.#round += 1;
    this.#history.push({
      at: now,
      actorId: input.actorId,
      action: 'resubmitted',
      round: this.#round,
    });
    if (input.requesterIsExecutive) {
      this.#history.push({
        at: now,
        actorId: input.actorId,
        action: 'executive_not_required',
        stage: 'executive',
        round: this.#round,
      });
    }
    this.#status = input.requesterIsExecutive ? 'pending_finance' : 'pending_executive';
    this.#touch(now);
    this.#emit(REQUISITION_EVENT_TYPES.resubmitted, context);
  }

  /** The requester withdraws a request that has not been approved. */
  withdraw(
    input: { actorId: string; comment?: string },
    context: RequisitionEventContext,
    now = nowIso(),
  ): void {
    if (input.actorId !== this.#requestedBy) {
      throw new RequisitionNotPermittedError('Only the requester can withdraw a hiring request');
    }
    if (this.#status === 'approved' || this.#status === 'withdrawn') {
      throw new RequisitionStateError('This hiring request can no longer be withdrawn', {
        status: this.#status,
      });
    }
    const comment = normalizeComment(input.comment);
    this.#history.push({
      at: now,
      actorId: input.actorId,
      action: 'withdrawn',
      ...(comment === undefined ? {} : { comment }),
      round: this.#round,
    });
    this.#status = 'withdrawn';
    this.#touch(now);
    this.#emit(REQUISITION_EVENT_TYPES.withdrawn, context);
  }

  /** Returns and clears the events recorded since the last call. */
  pullDomainEvents(): readonly EventEnvelope[] {
    return this.#events.splice(0);
  }

  #touch(now: string): void {
    this.#updatedAt = now;
    this.#version += 1;
  }

  #emit(type: string, context: RequisitionEventContext, extra: Record<string, unknown> = {}): void {
    this.#events.push(
      requisitionEvent(type, context, this.#workspaceId, {
        requisitionId: this.#id,
        organizationId: this.#organizationId,
        workspaceId: this.#workspaceId,
        requestedBy: this.#requestedBy,
        jobTitle: this.#details.jobTitle,
        headcount: this.#details.headcount,
        status: this.#status,
        round: this.#round,
        ...extra,
      }),
    );
  }
}

/** The requester-supplied details of a snapshot. */
function detailsOf(snapshot: HiringRequisitionSnapshot): RequisitionDetails {
  return {
    jobTitle: snapshot.jobTitle,
    department: snapshot.department,
    ...(snapshot.projectId === undefined ? {} : { projectId: snapshot.projectId }),
    headcount: snapshot.headcount,
    employmentType: snapshot.employmentType,
    salaryMinMinorUnits: snapshot.salaryMinMinorUnits,
    salaryMaxMinorUnits: snapshot.salaryMaxMinorUnits,
    currency: snapshot.currency,
    justification: snapshot.justification,
    urgency: snapshot.urgency,
    ...(snapshot.targetStartDate === undefined
      ? {}
      : { targetStartDate: snapshot.targetStartDate }),
  };
}
