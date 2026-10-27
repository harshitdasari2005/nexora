/**
 * @nexora/domain-hr — OfficeRequest aggregate root.
 *
 * One piece of office work travelling its chain. What it asks for and which
 * stages it passes through come from the workflow catalog
 * (`workflow-catalog.ts`): leave goes to the manager and then HR, a marketing
 * campaign to the marketing head, Finance and Legal before it is launched and
 * measured, a customer problem to support and engineering, and so on.
 *
 * The rules are the same for every workflow and are enforced here, whoever
 * calls:
 *
 * - stages are taken in order, one at a time;
 * - nobody takes a DECISION on their own request (doing your own part of the
 *   work is fine);
 * - saying no needs a reason and ends the request;
 * - a stage whose result must be written down cannot be finished without it;
 * - only the requester can withdraw, and only while the request is pending.
 *
 * A decision the requester would have to take themselves (HR asking for leave
 * has no HR above them; the CEO has no manager) is recorded as not required
 * when the request is raised and passed over when the chain reaches it — but
 * at least one decision always stays with someone else.
 */

import { nowIso } from '@nexora/shared/time';
import type { TenantId, WorkspaceId } from '@nexora/contracts/common';

import {
  InvalidEmployeeValueError,
  OfficeRequestNotPermittedError,
  OfficeRequestStateError,
} from '../errors/index.js';
import { OfficeRequestId } from '../value-objects/recruiting-ids.js';
import {
  findWorkflow,
  findWorkflowStage,
  type WorkflowDefinition,
  type WorkflowStageDefinition,
} from './workflow-catalog.js';

export const OFFICE_REQUEST_STATUSES = ['pending', 'approved', 'rejected', 'withdrawn'] as const;
export type OfficeRequestStatus = (typeof OFFICE_REQUEST_STATUSES)[number];

/** The currency money fields are kept in (one per deployment for now). */
export const OFFICE_REQUEST_CURRENCY = 'INR';

/**
 * What the requester fills in: the workflow, why they ask, and the workflow's
 * own fields (text, dates as `YYYY-MM-DD`, money in minor units, numbers).
 */
export type OfficeRequestDetails = {
  /** The workflow key (see the catalog). */
  type: string;
  reason: string;
} & Record<string, string | number>;

/** One step in a request's life. */
export interface OfficeRequestHistoryEntry {
  /** ISO-8601 UTC time. */
  at: string;
  actorId: string;
  /**
   * `assisted`: the assistant helped the actor (drafted the request, prepared a
   * brief, drafted a piece of writing). It records help, never a decision.
   */
  action: 'submitted' | 'not_required' | 'approved' | 'rejected' | 'withdrawn' | 'assisted';
  /** The stage key the step belongs to. */
  stage?: string;
  comment?: string;
}

/** Input for raising a request. */
export interface SubmitOfficeRequestInput {
  organizationId: TenantId;
  /** The workspace (team) the requester asks from — their manager decides there. */
  workspaceId: WorkspaceId;
  requestedBy: string;
  details: OfficeRequestDetails;
  /**
   * Keys of the stages whose seat the requester holds themselves (decisions
   * and work alike). Their own decisions are passed over; their own work stays.
   */
  heldByRequester?: readonly string[];
  /** The assistant drafted the request from the requester's own words. */
  draftedWithAssistant?: boolean;
}

/** A persistence snapshot of the {@link OfficeRequest}. */
export interface OfficeRequestSnapshot {
  id: OfficeRequestId;
  organizationId: TenantId;
  workspaceId: WorkspaceId;
  requestedBy: string;
  details: OfficeRequestDetails;
  /** The keys of the stages this request passes through, in order (fixed when raised). */
  stages: readonly string[];
  /** How many stages are behind it (taken or not required). */
  stageIndex: number;
  status: OfficeRequestStatus;
  history: readonly OfficeRequestHistoryEntry[];
  createdAt: string;
  updatedAt: string;
  version: number;
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_MONEY = 100_000_000_000;

function invalid(path: string, message: string): never {
  throw new InvalidEmployeeValueError('Invalid request', [{ path, message }]);
}

function requireWorkflow(type: unknown): WorkflowDefinition {
  const definition = typeof type === 'string' ? findWorkflow(type) : undefined;
  if (definition === undefined) invalid('type', 'Choose one of the office workflows');
  return definition;
}

/** Validates and normalizes the requester's details (throws on anything invalid). */
export function normalizeOfficeRequestDetails(details: OfficeRequestDetails): OfficeRequestDetails {
  const definition = requireWorkflow(details.type);
  const reason = typeof details.reason === 'string' ? details.reason.trim() : '';
  if (reason.length < 5 || reason.length > 2000) {
    invalid('reason', `${definition.reasonLabel}: write a few words (5–2000 characters)`);
  }
  const normalized: OfficeRequestDetails = { type: definition.key, reason };
  for (const field of definition.fields) {
    const raw = details[field.key];
    const missing =
      raw === undefined || raw === '' || (typeof raw === 'string' && raw.trim() === '');
    if (missing) {
      if (field.required) invalid(field.key, `${field.label} is required`);
      continue;
    }
    switch (field.type) {
      case 'text':
      case 'longtext': {
        const value = typeof raw === 'string' ? raw.trim() : '';
        const max = field.type === 'text' ? 160 : 4000;
        if (value.length < 2 || value.length > max) {
          invalid(field.key, `${field.label}: 2–${max} characters`);
        }
        normalized[field.key] = value;
        break;
      }
      case 'date': {
        const value = typeof raw === 'string' ? raw : '';
        if (!DATE.test(value) || Number.isNaN(Date.parse(`${value}T00:00:00Z`))) {
          invalid(field.key, `${field.label} must be a date`);
        }
        normalized[field.key] = value;
        break;
      }
      case 'money': {
        if (typeof raw !== 'number' || !Number.isInteger(raw) || raw <= 0 || raw > MAX_MONEY) {
          invalid(field.key, `${field.label} must be an amount above zero`);
        }
        normalized[field.key] = raw;
        normalized['currency'] = OFFICE_REQUEST_CURRENCY;
        break;
      }
      case 'number': {
        if (typeof raw !== 'number' || !Number.isFinite(raw) || raw < 0 || raw > 1_000_000) {
          invalid(field.key, `${field.label} must be a number`);
        }
        normalized[field.key] = raw;
        break;
      }
      case 'choice': {
        if (typeof raw !== 'string' || !(field.options ?? []).includes(raw)) {
          invalid(field.key, `${field.label}: choose one of ${(field.options ?? []).join(', ')}`);
        }
        normalized[field.key] = raw;
        break;
      }
    }
  }
  // The one rule that spans two fields: a period cannot end before it starts.
  for (const [start, end] of [
    ['startDate', 'endDate'],
    ['from', 'to'],
  ] as const) {
    const first = normalized[start];
    const last = normalized[end];
    if (typeof first === 'string' && typeof last === 'string' && last < first) {
      invalid(end, 'The last day cannot be before the first day');
    }
  }
  return normalized;
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
    const stages = requireWorkflow(details.type).stages.map((stage) => stage.key);
    const request = new OfficeRequest({
      id: OfficeRequestId.create(),
      organizationId: input.organizationId,
      workspaceId: input.workspaceId,
      requestedBy: input.requestedBy,
      details,
      stages: [...stages],
      stageIndex: 0,
      status: 'pending',
      history: [
        { at: now, actorId: input.requestedBy, action: 'submitted' },
        ...(input.draftedWithAssistant === true
          ? [
              {
                at: now,
                actorId: input.requestedBy,
                action: 'assisted' as const,
                comment: 'drafted the request from their description',
              },
            ]
          : []),
      ],
      createdAt: now,
      updatedAt: now,
      version: 1,
    });
    request.#markNotRequired(input.heldByRequester ?? [], now);
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
  /** The workflow key. */
  get type(): string {
    return this.#state.details.type;
  }
  /** The workflow this request follows (undefined only for a retired workflow). */
  get workflow(): WorkflowDefinition | undefined {
    return findWorkflow(this.#state.details.type);
  }
  get status(): OfficeRequestStatus {
    return this.#state.status;
  }
  get stages(): readonly string[] {
    return this.#state.stages;
  }
  get version(): number {
    return this.#state.version;
  }

  /** The key of the stage the request is waiting at, while it is pending. */
  get pendingStage(): string | undefined {
    return this.#state.status === 'pending'
      ? this.#state.stages[this.#state.stageIndex]
      : undefined;
  }

  /** The definition of the stage the request is waiting at. */
  get pendingStageDefinition(): WorkflowStageDefinition | undefined {
    const key = this.pendingStage;
    const workflow = this.workflow;
    return key === undefined || workflow === undefined
      ? undefined
      : findWorkflowStage(workflow, key);
  }

  /** Where every stage of the chain stands, in order. */
  stageStates(): { key: string; state: 'done' | 'current' | 'waiting' | 'skipped' | 'returned' }[] {
    return this.#state.stages.map((key, index) => {
      const entry = this.#state.history.find(
        (item) => item.stage === key && item.action !== 'assisted',
      );
      const state =
        entry?.action === 'approved'
          ? ('done' as const)
          : entry?.action === 'not_required'
            ? ('skipped' as const)
            : entry?.action === 'rejected'
              ? ('returned' as const)
              : this.#state.status === 'pending' && index === this.#state.stageIndex
                ? ('current' as const)
                : ('waiting' as const);
      return { key, state };
    });
  }

  /** Why this person cannot take the pending stage right now (undefined when they can). */
  decisionBlocker(actorId: string): string | undefined {
    const stage = this.pendingStageDefinition;
    if (stage === undefined) return 'This request is no longer waiting for anyone';
    const isRequester = actorId === this.#state.requestedBy;
    if (stage.seat === 'requester') {
      return isRequester ? undefined : 'Only the person who raised this can take this step';
    }
    if (stage.kind === 'decide' && isRequester) return 'You cannot decide your own request';
    return undefined;
  }

  /**
   * Takes the stage the request is waiting at: `approve` says yes to a
   * decision or finishes a piece of work; `reject` says no, with a reason.
   */
  decide(
    input: {
      stage: string;
      decision: 'approve' | 'reject';
      actorId: string;
      comment?: string;
    },
    now = nowIso(),
  ): void {
    const pending = this.pendingStageDefinition;
    if (pending === undefined) {
      throw new OfficeRequestStateError('This request is no longer waiting for anyone', {
        status: this.#state.status,
      });
    }
    if (input.stage !== pending.key) {
      throw new OfficeRequestStateError('This request is waiting at a different stage', {
        pendingStage: pending.key,
      });
    }
    const blocker = this.decisionBlocker(input.actorId);
    if (blocker !== undefined) throw new OfficeRequestNotPermittedError(blocker);
    const comment = typeof input.comment === 'string' ? input.comment.trim() : '';
    if (comment.length > 4000) {
      throw new InvalidEmployeeValueError('Invalid comment', [
        { path: 'comment', message: 'At most 4000 characters' },
      ]);
    }
    if (input.decision === 'reject') {
      if (comment.length < 3) {
        throw new InvalidEmployeeValueError('A reason is required to say no', [
          { path: 'comment', message: 'Say why' },
        ]);
      }
      this.#state.status = 'rejected';
      this.#record({
        at: now,
        actorId: input.actorId,
        action: 'rejected',
        stage: pending.key,
        comment,
      });
      return;
    }
    if (pending.noteRequired === true && comment.length < 3) {
      throw new InvalidEmployeeValueError('This step needs to be written down', [
        { path: 'comment', message: pending.noteLabel ?? 'Write down the outcome' },
      ]);
    }
    this.#state.stageIndex += 1;
    this.#record({
      at: now,
      actorId: input.actorId,
      action: 'approved',
      stage: pending.key,
      ...(comment.length === 0 ? {} : { comment }),
    });
    this.#passNotRequired();
    if (this.#state.stageIndex >= this.#state.stages.length) this.#state.status = 'approved';
  }

  /**
   * Records that the assistant helped someone with this request: who asked,
   * and with what. Help is on the record like everything else.
   */
  noteAssistance(actorId: string, what: string, now = nowIso()): void {
    this.#record({ at: now, actorId, action: 'assisted', comment: what.slice(0, 200) });
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
   * Records the DECISIONS the requester would have to take themselves. Work
   * stages are never passed over. And a request never completes without
   * someone else: when nobody but the requester would touch it, the last
   * decision stays required (and waits for someone above them).
   */
  #markNotRequired(heldByRequester: readonly string[], now: string): void {
    const workflow = this.workflow;
    if (workflow === undefined) return;
    const others = workflow.stages.filter((stage) => stage.seat !== 'requester');
    const marked = others.filter(
      (stage) => stage.kind === 'decide' && heldByRequester.includes(stage.key),
    );
    const someoneElseInvolved = others.some((stage) => !heldByRequester.includes(stage.key));
    if (!someoneElseInvolved) marked.pop();
    this.#state.history = [
      ...this.#state.history,
      ...marked.map((stage) => ({
        at: now,
        actorId: this.#state.requestedBy,
        action: 'not_required' as const,
        stage: stage.key,
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
      skipped.has(this.#state.stages[this.#state.stageIndex] as string)
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
