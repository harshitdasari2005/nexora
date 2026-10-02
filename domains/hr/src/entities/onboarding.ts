/**
 * @nexora/domain-hr — Onboarding aggregate root.
 *
 * The checklist a new hire goes through between "offer accepted" and "ready to
 * work". Every item belongs to the part of the office that actually does it:
 *
 *   paperwork    HR        contract and employment documents
 *   accounts     IT        email and system accounts
 *   equipment    IT        laptop and equipment
 *   buddy        Manager   a buddy on the team (named)
 *   orientation  HR        first-day orientation
 *
 * An item is completed once, by someone acting for its owner. When every item
 * is done the onboarding is `completed` — the signal that the employee becomes
 * active and can be assigned to work.
 */

import type { EventEnvelope } from '@nexora/shared/events';
import { nowIso } from '@nexora/shared/time';
import type { TenantId, WorkspaceId } from '@nexora/contracts/common';

import { InvalidEmployeeValueError, OnboardingStateError } from '../errors/index.js';
import {
  recruitingEvent,
  RECRUITING_EVENT_TYPES,
  type RecruitingEventContext,
} from '../events/recruiting-events.js';
import { OnboardingId } from '../value-objects/recruiting-ids.js';

/** The part of the office responsible for an item. */
export const ONBOARDING_OWNERS = ['hr', 'it', 'manager'] as const;
export type OnboardingOwner = (typeof ONBOARDING_OWNERS)[number];

/** The checklist, in the order it is shown. */
export const ONBOARDING_ITEMS = [
  { key: 'paperwork', owner: 'hr', title: 'Contract and paperwork signed' },
  { key: 'accounts', owner: 'it', title: 'Email and system accounts created' },
  { key: 'equipment', owner: 'it', title: 'Laptop and equipment ready' },
  { key: 'buddy', owner: 'manager', title: 'Buddy on the team assigned' },
  { key: 'orientation', owner: 'hr', title: 'First-day orientation scheduled' },
] as const satisfies readonly { key: string; owner: OnboardingOwner; title: string }[];

export type OnboardingItemKey = (typeof ONBOARDING_ITEMS)[number]['key'];

/** One checklist item's state. */
export interface OnboardingItem {
  key: OnboardingItemKey;
  owner: OnboardingOwner;
  title: string;
  done: boolean;
  doneBy?: string;
  doneAt?: string;
  /** A note recorded on completion (the buddy's name for the `buddy` item). */
  note?: string;
}

/** Input for starting an onboarding. */
export interface StartOnboardingInput {
  organizationId: TenantId;
  employeeId: string;
  /** Denormalized for lists (the employee record stays the source of truth). */
  employeeName: string;
  /** The team's workspace the hire belongs to. */
  workspaceId: WorkspaceId;
  /** The person who asked for the hire — owns the manager's items. */
  hiringManagerId: string;
  /** The project the hire was requested for, when there was one. */
  projectId?: string;
  startedBy: string;
}

/** A persistence snapshot of the {@link Onboarding}. */
export interface OnboardingSnapshot {
  id: OnboardingId;
  organizationId: TenantId;
  employeeId: string;
  employeeName: string;
  workspaceId: WorkspaceId;
  hiringManagerId: string;
  projectId?: string;
  startedBy: string;
  status: 'in_progress' | 'completed';
  items: readonly OnboardingItem[];
  completedAt?: string;
  createdAt: string;
  updatedAt: string;
  version: number;
}

/** The {@link Onboarding} aggregate root. */
export class Onboarding {
  #state: OnboardingSnapshot;
  readonly #events: EventEnvelope[] = [];

  private constructor(snapshot: OnboardingSnapshot) {
    this.#state = { ...snapshot, items: snapshot.items.map((item) => ({ ...item })) };
  }

  /** Starts the onboarding of a hired employee with the standard checklist. */
  static start(
    input: StartOnboardingInput,
    context: RecruitingEventContext,
    now = nowIso(),
  ): Onboarding {
    const onboarding = new Onboarding({
      id: OnboardingId.create(),
      organizationId: input.organizationId,
      employeeId: input.employeeId,
      employeeName: input.employeeName,
      workspaceId: input.workspaceId,
      hiringManagerId: input.hiringManagerId,
      ...(input.projectId === undefined ? {} : { projectId: input.projectId }),
      startedBy: input.startedBy,
      status: 'in_progress',
      items: ONBOARDING_ITEMS.map((item) => ({ ...item, done: false })),
      createdAt: now,
      updatedAt: now,
      version: 1,
    });
    onboarding.#emit(RECRUITING_EVENT_TYPES.onboardingStarted, context);
    return onboarding;
  }

  static hydrate(snapshot: OnboardingSnapshot): Onboarding {
    return new Onboarding(snapshot);
  }

  static snapshot(onboarding: Onboarding): OnboardingSnapshot {
    const state = onboarding.#state;
    return { ...state, items: state.items.map((item) => ({ ...item })) };
  }

  get id(): OnboardingId {
    return this.#state.id;
  }
  get organizationId(): TenantId {
    return this.#state.organizationId;
  }
  get employeeId(): string {
    return this.#state.employeeId;
  }
  get hiringManagerId(): string {
    return this.#state.hiringManagerId;
  }
  get status(): OnboardingSnapshot['status'] {
    return this.#state.status;
  }
  get isCompleted(): boolean {
    return this.#state.status === 'completed';
  }
  get version(): number {
    return this.#state.version;
  }

  /** The item with this key, or `undefined` for an unknown key. */
  item(key: string): OnboardingItem | undefined {
    const found = this.#state.items.find((item) => item.key === key);
    return found === undefined ? undefined : { ...found };
  }

  /**
   * Marks one item done. The caller has already established the actor may act
   * for the item's owner. Completing the last item completes the onboarding.
   *
   * @returns `true` when this completion finished the whole onboarding.
   */
  completeItem(
    input: { key: string; actorId: string; note?: string },
    context: RecruitingEventContext,
    now = nowIso(),
  ): boolean {
    const item = this.#state.items.find((entry) => entry.key === input.key);
    if (item === undefined) {
      throw new InvalidEmployeeValueError('Unknown onboarding item', [
        {
          path: 'item',
          message: `Must be one of: ${ONBOARDING_ITEMS.map((i) => i.key).join(', ')}`,
        },
      ]);
    }
    if (item.done) {
      throw new OnboardingStateError('This onboarding item is already done', { item: item.key });
    }
    const note = typeof input.note === 'string' ? input.note.trim() : '';
    if (note.length > 300) {
      throw new InvalidEmployeeValueError('Invalid note', [
        { path: 'note', message: 'Must be at most 300 characters' },
      ]);
    }
    if (item.key === 'buddy' && note.length < 2) {
      throw new InvalidEmployeeValueError('Name the buddy', [
        { path: 'note', message: 'Say who the buddy is' },
      ]);
    }
    this.#state.items = this.#state.items.map((entry) =>
      entry.key === item.key
        ? {
            ...entry,
            done: true,
            doneBy: input.actorId,
            doneAt: now,
            ...(note.length === 0 ? {} : { note }),
          }
        : entry,
    );
    const finished = this.#state.items.every((entry) => entry.done);
    if (finished) {
      this.#state.status = 'completed';
      this.#state.completedAt = now;
    }
    this.#state.updatedAt = now;
    this.#state.version += 1;
    this.#emit(RECRUITING_EVENT_TYPES.onboardingItemCompleted, context, { item: item.title });
    if (finished) this.#emit(RECRUITING_EVENT_TYPES.onboardingCompleted, context);
    return finished;
  }

  pullDomainEvents(): readonly EventEnvelope[] {
    return this.#events.splice(0);
  }

  #emit(type: string, context: RecruitingEventContext, extra: Record<string, unknown> = {}): void {
    this.#events.push(
      recruitingEvent(type, context, this.#state.workspaceId, {
        onboardingId: this.#state.id,
        employeeId: this.#state.employeeId,
        employeeName: this.#state.employeeName,
        status: this.#state.status,
        ...extra,
      }),
    );
  }
}
