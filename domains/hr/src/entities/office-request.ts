/**
 * @nexora/domain-hr — OfficeRequest aggregate root.
 *
 * The everyday requests of an office, each travelling its own chain of people:
 *
 *   leave     the employee asks → their manager → HR
 *   purchase  the employee asks → their manager → Finance
 *   access    the employee asks → their manager → IT
 *
 * One aggregate carries all of them: the request type decides which stages it
 * passes through and which details it needs. The rules are the same for every
 * type and are enforced here, whoever calls:
 *
 * - stages are decided in order, one at a time;
 * - nobody decides their own request;
 * - a rejection needs a reason and ends the request;
 * - only the requester can withdraw it, and only while it is still pending.
 *
 * A stage the requester would have to decide themselves (HR asking for leave
 * has no HR above them; the CEO has no manager) is recorded as not required
 * when the request is raised and passed over when the chain reaches it, so a
 * request never waits on its own requester.
 */

import { nowIso } from '@nexora/shared/time';
import type { TenantId, WorkspaceId } from '@nexora/contracts/common';

import {
  InvalidEmployeeValueError,
  OfficeRequestNotPermittedError,
  OfficeRequestStateError,
} from '../errors/index.js';
import { OfficeRequestId } from '../value-objects/recruiting-ids.js';

/** Who decides a stage. */
export const OFFICE_REQUEST_STAGES = ['manager', 'hr', 'finance', 'it'] as const;
export type OfficeRequestStage = (typeof OFFICE_REQUEST_STAGES)[number];

/** The kinds of request, with the chain each one travels. */
export const OFFICE_REQUEST_TYPES = {
  leave: { stages: ['manager', 'hr'] },
  purchase: { stages: ['manager', 'finance'] },
  access: { stages: ['manager', 'it'] },
} as const satisfies Record<string, { stages: readonly OfficeRequestStage[] }>;
export type OfficeRequestType = keyof typeof OFFICE_REQUEST_TYPES;
export const OFFICE_REQUEST_TYPE_KEYS = Object.keys(OFFICE_REQUEST_TYPES) as OfficeRequestType[];

export const OFFICE_REQUEST_STATUSES = ['pending', 'approved', 'rejected', 'withdrawn'] as const;
export type OfficeRequestStatus = (typeof OFFICE_REQUEST_STATUSES)[number];

export const LEAVE_KINDS = ['vacation', 'sick', 'personal'] as const;
export type LeaveKind = (typeof LEAVE_KINDS)[number];

/** What the requester fills in, by type. */
export type OfficeRequestDetails =
  | { type: 'leave'; kind: LeaveKind; startDate: string; endDate: string; reason: string }
  | { type: 'purchase'; item: string; amountMinorUnits: number; currency: string; reason: string }
  | { type: 'access'; what: string; reason: string };

/** One step in a request's life. */
export interface OfficeRequestHistoryEntry {
  /** ISO-8601 UTC time. */
  at: string;
  actorId: string;
  action: 'submitted' | 'not_required' | 'approved' | 'rejected' | 'withdrawn';
  stage?: OfficeRequestStage;
  comment?: string;
}

/** Input for raising a request. */
export interface SubmitOfficeRequestInput {
  organizationId: TenantId;
  /** The workspace (team) the requester asks from — their manager decides there. */
  workspaceId: WorkspaceId;
  requestedBy: string;
  details: OfficeRequestDetails;
  /** Stages the requester would have to decide themselves: recorded as not required. */
  notRequired?: readonly OfficeRequestStage[];
}

/** A persistence snapshot of the {@link OfficeRequest}. */
export interface OfficeRequestSnapshot {
  id: OfficeRequestId;
  organizationId: TenantId;
  workspaceId: WorkspaceId;
  requestedBy: string;
  details: OfficeRequestDetails;
  /** The stages this request passes through, in order (fixed when raised). */
  stages: readonly OfficeRequestStage[];
  /** How many stages are behind it (decided or not required). */
  stageIndex: number;
  status: OfficeRequestStatus;
  history: readonly OfficeRequestHistoryEntry[];
  createdAt: string;
  updatedAt: string;
  version: number;
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;

function text(path: string, value: unknown, min: number, max: number, label: string): string {
  const trimmed = typeof value === 'string' ? value.trim() : '';
  if (trimmed.length < min || trimmed.length > max) {
    throw new InvalidEmployeeValueError('Invalid request', [
      { path, message: `${label} (${min}–${max} characters)` },
    ]);
  }
  return trimmed;
}

/** Validates and normalizes the requester's details (throws on anything invalid). */
export function normalizeOfficeRequestDetails(details: OfficeRequestDetails): OfficeRequestDetails {
  const reason = text('reason', details.reason, 5, 1000, 'Say why you are asking');
  switch (details.type) {
    case 'leave': {
      if (!LEAVE_KINDS.includes(details.kind)) {
        throw new InvalidEmployeeValueError('Invalid request', [
          { path: 'kind', message: `Must be one of: ${LEAVE_KINDS.join(', ')}` },
        ]);
      }
      const valid = (value: string): boolean =>
        DATE.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));
      if (!valid(details.startDate) || !valid(details.endDate)) {
        throw new InvalidEmployeeValueError('Invalid request', [
          { path: 'startDate', message: 'Give the first and last day as dates' },
        ]);
      }
      if (details.endDate < details.startDate) {
        throw new InvalidEmployeeValueError('Invalid request', [
          { path: 'endDate', message: 'The last day cannot be before the first day' },
        ]);
      }
      return {
        type: 'leave',
        kind: details.kind,
        startDate: details.startDate,
        endDate: details.endDate,
        reason,
      };
    }
    case 'purchase': {
      if (
        !Number.isInteger(details.amountMinorUnits) ||
        details.amountMinorUnits <= 0 ||
        details.amountMinorUnits > 100_000_000_000
      ) {
        throw new InvalidEmployeeValueError('Invalid request', [
          { path: 'amountMinorUnits', message: 'Enter what it costs' },
        ]);
      }
      if (typeof details.currency !== 'string' || !/^[A-Z]{3}$/.test(details.currency)) {
        throw new InvalidEmployeeValueError('Invalid request', [
          { path: 'currency', message: 'Must be a three-letter currency code' },
        ]);
      }
      return {
        type: 'purchase',
        item: text('item', details.item, 2, 160, 'Say what should be bought'),
        amountMinorUnits: details.amountMinorUnits,
        currency: details.currency,
        reason,
      };
    }
    case 'access':
      return {
        type: 'access',
        what: text('what', details.what, 2, 160, 'Say what you need access to'),
        reason,
      };
    default:
      throw new InvalidEmployeeValueError('Invalid request', [
        { path: 'type', message: `Must be one of: ${OFFICE_REQUEST_TYPE_KEYS.join(', ')}` },
      ]);
  }
}

/** The {@link OfficeRequest} aggregate root. */
export class OfficeRequest {
  #state: OfficeRequestSnapshot;

  private constructor(snapshot: OfficeRequestSnapshot) {
    this.#state = { ...snapshot, history: [...snapshot.history] };
  }

  /** Raises a request; it waits at the first stage that is required. */
  static submit(input: SubmitOfficeRequestInput, now = nowIso()): OfficeRequest {
    const details = normalizeOfficeRequestDetails(input.details);
    const stages = OFFICE_REQUEST_TYPES[details.type].stages;
    const request = new OfficeRequest({
      id: OfficeRequestId.create(),
      organizationId: input.organizationId,
      workspaceId: input.workspaceId,
      requestedBy: input.requestedBy,
      details,
      stages: [...stages],
      stageIndex: 0,
      status: 'pending',
      history: [{ at: now, actorId: input.requestedBy, action: 'submitted' }],
      createdAt: now,
      updatedAt: now,
      version: 1,
    });
    request.#markNotRequired(input.notRequired ?? [], now);
    request.#passNotRequired();
    return request;
  }

  static hydrate(snapshot: OfficeRequestSnapshot): OfficeRequest {
    if (!OFFICE_REQUEST_STATUSES.includes(snapshot.status)) {
      throw new InvalidEmployeeValueError('Invalid request status', [
        { path: 'status', message: `Must be one of: ${OFFICE_REQUEST_STATUSES.join(', ')}` },
      ]);
    }
    return new OfficeRequest(snapshot);
  }

  static snapshot(request: OfficeRequest): OfficeRequestSnapshot {
    return { ...request.#state, history: [...request.#state.history] };
  }

  get id(): OfficeRequestId {
    return this.#state.id;
  }
  get organizationId(): TenantId {
    return this.#state.organizationId;
  }
  get workspaceId(): WorkspaceId {
    return this.#state.workspaceId;
  }
  get requestedBy(): string {
    return this.#state.requestedBy;
  }
  get type(): OfficeRequestType {
    return this.#state.details.type;
  }
  get status(): OfficeRequestStatus {
    return this.#state.status;
  }
  get stages(): readonly OfficeRequestStage[] {
    return this.#state.stages;
  }
  get version(): number {
    return this.#state.version;
  }

  /** The stage the request is waiting at, while it is pending. */
  get pendingStage(): OfficeRequestStage | undefined {
    return this.#state.status === 'pending'
      ? this.#state.stages[this.#state.stageIndex]
      : undefined;
  }

  /** Why this person cannot decide the request right now (undefined when they can). */
  decisionBlocker(actorId: string): string | undefined {
    if (this.#state.status !== 'pending') return 'This request is no longer waiting for a decision';
    if (actorId === this.#state.requestedBy) return 'You cannot decide your own request';
    return undefined;
  }

  /** Decides the stage the request is waiting at. */
  decide(
    input: {
      stage: OfficeRequestStage;
      decision: 'approve' | 'reject';
      actorId: string;
      comment?: string;
    },
    now = nowIso(),
  ): void {
    const pending = this.pendingStage;
    if (pending === undefined) {
      throw new OfficeRequestStateError('This request is no longer waiting for a decision', {
        status: this.#state.status,
      });
    }
    if (input.stage !== pending) {
      throw new OfficeRequestStateError('This request is waiting at a different stage', {
        pendingStage: pending,
      });
    }
    if (input.actorId === this.#state.requestedBy) {
      throw new OfficeRequestNotPermittedError('You cannot decide your own request');
    }
    const comment = typeof input.comment === 'string' ? input.comment.trim() : '';
    if (comment.length > 1000) {
      throw new InvalidEmployeeValueError('Invalid comment', [
        { path: 'comment', message: 'At most 1000 characters' },
      ]);
    }
    if (input.decision === 'reject') {
      if (comment.length < 3) {
        throw new InvalidEmployeeValueError('A reason is required to reject a request', [
          { path: 'comment', message: 'Say why the request is rejected' },
        ]);
      }
      this.#state.status = 'rejected';
      this.#record({
        at: now,
        actorId: input.actorId,
        action: 'rejected',
        stage: pending,
        comment,
      });
      return;
    }
    this.#state.stageIndex += 1;
    this.#record({
      at: now,
      actorId: input.actorId,
      action: 'approved',
      stage: pending,
      ...(comment.length === 0 ? {} : { comment }),
    });
    this.#passNotRequired();
    if (this.#state.stageIndex >= this.#state.stages.length) this.#state.status = 'approved';
  }

  /** The requester takes the request back while it is still pending. */
  withdraw(actorId: string, now = nowIso()): void {
    if (actorId !== this.#state.requestedBy) {
      throw new OfficeRequestNotPermittedError('Only the requester can withdraw a request');
    }
    if (this.#state.status !== 'pending') {
      throw new OfficeRequestStateError('Only a pending request can be withdrawn', {
        status: this.#state.status,
      });
    }
    this.#state.status = 'withdrawn';
    this.#record({ at: now, actorId, action: 'withdrawn' });
  }

  /**
   * Records the stages the requester would have to decide themselves. A
   * request always needs at least one other person, so when that would be
   * every stage, the last one stays required.
   */
  #markNotRequired(notRequired: readonly OfficeRequestStage[], now: string): void {
    const stages = this.#state.stages;
    const marked = stages.filter((stage) => notRequired.includes(stage));
    if (marked.length === stages.length) marked.pop();
    this.#state.history = [
      ...this.#state.history,
      ...marked.map((stage) => ({
        at: now,
        actorId: this.#state.requestedBy,
        action: 'not_required' as const,
        stage,
      })),
    ];
  }

  /** Moves past every stage recorded as not required, wherever it sits in the chain. */
  #passNotRequired(): void {
    const skipped = new Set(
      this.#state.history
        .filter((entry) => entry.action === 'not_required')
        .map((entry) => entry.stage),
    );
    while (
      this.#state.stageIndex < this.#state.stages.length &&
      skipped.has(this.#state.stages[this.#state.stageIndex])
    ) {
      this.#state.stageIndex += 1;
    }
  }

  #record(entry: OfficeRequestHistoryEntry): void {
    this.#state.history = [...this.#state.history, entry];
    this.#state.updatedAt = entry.at;
    this.#state.version += 1;
  }
}
