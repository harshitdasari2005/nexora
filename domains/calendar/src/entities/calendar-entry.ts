/**
 * @nexora/module-calendar — CalendarEntry aggregate root.
 *
 * The central aggregate of the Calendar bounded context (DOMAIN_MODEL.md
 * §4.5): a scheduled time window (an entry on a calendar) owned by exactly
 * one organization (the `organizationId`, immutable) and one workspace (the
 * `workspaceId`, immutable), created by exactly one user (the `createdBy`,
 * immutable), with a title and a lifecycle (`scheduled → cancelled`;
 * cancelled is terminal). Authorization is NEVER derived from the title or
 * any free-text — the aggregate carries its scope explicitly, and every
 * read/write is gated by the trusted tenant + workspace.
 *
 * All state changes flow through aggregate methods, which enforce business
 * invariants and record domain events. No partial aggregate mutation on
 * validation failure: transitions validate the policy FIRST, then mutate,
 * then emit the event.
 */

import type { EventEnvelope } from '@nexora/shared/events';
import { nowIso } from '@nexora/shared/time';
import type { TenantId, UserId, WorkspaceId } from '@nexora/contracts/common';

import type { CalendarEventContext } from '../events/index.js';
import {
  calendarEventCancelledEvent,
  calendarEventCreatedEvent,
  calendarEventUpdatedEvent,
} from '../events/index.js';
import { CalendarEntryStateTransitionError } from '../errors/index.js';
import { CALENDAR_ENTRY_TRANSITIONS } from '../policies/index.js';
import type { CalendarEntryId } from '../value-objects/calendar-entry-id.js';
import { CalendarEntryId as CalendarEntryIdFactory } from '../value-objects/calendar-entry-id.js';
import { CalendarEntryStatus } from '../value-objects/calendar-entry-status.js';
import { CalendarEntryTitle } from '../value-objects/calendar-entry-title.js';
import { EventTimeWindow } from '../value-objects/event-time-window.js';

/** Input for creating a new {@link CalendarEntry}. */
export interface CreateCalendarEntryInput {
  /** The owning organization (tenant) id — immutable. */
  organizationId: TenantId;
  /** The owning workspace id — immutable (workspace isolation). */
  workspaceId: WorkspaceId;
  /** The user that creates the entry (the owner) — immutable. */
  createdBy: UserId;
  /** The entry title (validated). */
  title: string;
  /** ISO-8601 UTC start instant. */
  startsAt: string;
  /** ISO-8601 UTC end instant. */
  endsAt: string;
}

/** A persistence snapshot of the {@link CalendarEntry} aggregate. */
export interface CalendarEntrySnapshot {
  /** The calendar entry id. */
  id: CalendarEntryId;
  /** The owning organization (tenant) id. */
  organizationId: TenantId;
  /** The owning workspace id. */
  workspaceId: WorkspaceId;
  /** The user that created the entry. */
  createdBy: UserId;
  /** The title. */
  title: string;
  /** ISO-8601 UTC start instant. */
  startsAt: string;
  /** ISO-8601 UTC end instant. */
  endsAt: string;
  /** The lifecycle status value. */
  status: string;
  /** ISO-8601 UTC creation time. */
  createdAt: string;
  /** ISO-8601 UTC last mutation time. */
  updatedAt: string;
  /** Monotonic version for optimistic concurrency. */
  version: number;
}

/**
 * The {@link CalendarEntry} aggregate root. Use {@link CalendarEntry.create}
 * to construct; mutate only through aggregate methods so invariants stay
 * protected.
 */
export class CalendarEntry {
  // Not `readonly`: reassigned only by `hydrate` (reconstitution).
  #id: CalendarEntryId;
  readonly #organizationId: TenantId;
  readonly #workspaceId: WorkspaceId;
  readonly #createdBy: UserId;
  // Not `readonly`: reassigned by `reschedule` (mutation) and `hydrate`.
  #title: CalendarEntryTitle;
  #timeWindow: EventTimeWindow;
  #status: CalendarEntryStatus;
  readonly #createdAt: string;
  #updatedAt: string;
  #version: number;
  readonly #events: EventEnvelope[] = [];

  private constructor(input: CreateCalendarEntryInput, createdAt: string) {
    this.#id = CalendarEntryIdFactory.create();
    this.#organizationId = input.organizationId;
    this.#workspaceId = input.workspaceId;
    this.#createdBy = input.createdBy;
    this.#title = CalendarEntryTitle.create(input.title);
    this.#timeWindow = EventTimeWindow.create(input.startsAt, input.endsAt);
    this.#status = CalendarEntryStatus.scheduled();
    this.#createdAt = createdAt;
    this.#updatedAt = createdAt;
    this.#version = 1;
  }

  /**
   * Creates a new {@link CalendarEntry} in `scheduled` status and records a
   * {@link calendarEventCreatedEvent}.
   *
   * @param input   - creation data (organization, workspace, owner, title, window).
   * @param context - event context (actor, correlation id, organization, workspace).
   * @param now     - ISO-8601 UTC creation time (defaults to now).
   */
  static create(
    input: CreateCalendarEntryInput,
    context: CalendarEventContext,
    now = nowIso(),
  ): CalendarEntry {
    const entry = new CalendarEntry(input, now);
    entry.#events.push(
      calendarEventCreatedEvent(context, entry.#id, {
        calendarEntryId: entry.#id,
        title: entry.#title.value,
        organizationId: entry.#organizationId,
        workspaceId: entry.#workspaceId,
        createdBy: entry.#createdBy,
        startsAt: entry.#timeWindow.startsAt,
        endsAt: entry.#timeWindow.endsAt,
        status: entry.#status.value,
      }),
    );
    return entry;
  }

  /** The calendar entry id. */
  get id(): CalendarEntryId {
    return this.#id;
  }

  /** The owning organization (tenant) id — immutable (exactly one org). */
  get organizationId(): TenantId {
    return this.#organizationId;
  }

  /** The owning workspace id — immutable (workspace isolation). */
  get workspaceId(): WorkspaceId {
    return this.#workspaceId;
  }

  /** The user that created the entry (the owner). */
  get createdBy(): UserId {
    return this.#createdBy;
  }

  /** The entry title. */
  get title(): CalendarEntryTitle {
    return this.#title;
  }

  /** The time window (start/end). */
  get timeWindow(): EventTimeWindow {
    return this.#timeWindow;
  }

  /** The lifecycle status. */
  get status(): CalendarEntryStatus {
    return this.#status;
  }

  /** ISO-8601 UTC creation time. */
  get createdAt(): string {
    return this.#createdAt;
  }

  /** ISO-8601 UTC time of the last mutation. */
  get updatedAt(): string {
    return this.#updatedAt;
  }

  /** Monotonic version for optimistic concurrency (EntityMeta). */
  get version(): number {
    return this.#version;
  }

  /** Whether the entry is currently scheduled (not cancelled). */
  isScheduled(): boolean {
    return this.#status.isScheduled();
  }

  /**
   * Reschedules the entry (new title / time window) while it is still
   * `scheduled` and records a {@link calendarEventUpdatedEvent}. The owner
   * and scope never change — only the business content.
   *
   * @throws {CalendarEntryStateTransitionError} when the entry is cancelled.
   * @throws {InvalidCalendarEntryValueError} when the new title/window are invalid.
   */
  reschedule(
    input: { title: string; startsAt: string; endsAt: string },
    context: CalendarEventContext,
    now = nowIso(),
  ): void {
    this.#assertMutable('reschedule');
    // Validate → mutate: build the new values BEFORE any state changes, then
    // commit them to the aggregate and record the event.
    const nextTitle = CalendarEntryTitle.create(input.title);
    const nextWindow = EventTimeWindow.create(input.startsAt, input.endsAt);
    this.#title = nextTitle;
    this.#timeWindow = nextWindow;
    this.#bump(now);
    this.#events.push(
      calendarEventUpdatedEvent(context, this.#id, {
        calendarEntryId: this.#id,
        title: nextTitle.value,
        startsAt: nextWindow.startsAt,
        endsAt: nextWindow.endsAt,
      }),
    );
  }

  /**
   * Cancels the entry (`scheduled` → `cancelled` — terminal) and records a
   * {@link calendarEventCancelledEvent}.
   *
   * @throws {CalendarEntryStateTransitionError} when the entry is already cancelled.
   */
  cancel(context: CalendarEventContext, now = nowIso()): void {
    const allowed = CALENDAR_ENTRY_TRANSITIONS[this.#status.value];
    if (!allowed.includes('cancelled')) {
      throw new CalendarEntryStateTransitionError(
        `Cannot cancel a calendar entry in status ${this.#status.value}`,
        { calendarEntryId: this.#id, from: this.#status.value, to: 'cancelled' },
      );
    }
    // Validate → mutate: the transition is legal, then mutate and record.
    this.#status = CalendarEntryStatus.cancelled();
    this.#bump(now);
    this.#events.push(calendarEventCancelledEvent(context, this.#id));
  }

  /**
   * Produces a persistence snapshot of the entry (PERSISTENCE.md §4
   * aggregate ownership).
   */
  static snapshot(entry: CalendarEntry): CalendarEntrySnapshot {
    return {
      id: entry.id,
      organizationId: entry.organizationId,
      workspaceId: entry.workspaceId,
      createdBy: entry.createdBy,
      title: entry.title.value,
      startsAt: entry.timeWindow.startsAt,
      endsAt: entry.timeWindow.endsAt,
      status: entry.status.value,
      createdAt: entry.createdAt,
      updatedAt: entry.updatedAt,
      version: entry.version,
    };
  }

  /**
   * Reconstructs a {@link CalendarEntry} from a persistence snapshot without
   * emitting domain events (DDD reconstitution factory). Reuses the id from
   * the snapshot; values are re-validated through the value-object factories
   * at load.
   */
  static hydrate(snapshot: CalendarEntrySnapshot): CalendarEntry {
    const entry = new CalendarEntry(
      {
        organizationId: snapshot.organizationId,
        workspaceId: snapshot.workspaceId,
        createdBy: snapshot.createdBy,
        title: snapshot.title,
        startsAt: snapshot.startsAt,
        endsAt: snapshot.endsAt,
      },
      snapshot.createdAt,
    );
    entry.#id = snapshot.id;
    entry.#status = CalendarEntryStatus.from(snapshot.status);
    entry.#updatedAt = snapshot.updatedAt;
    entry.#version = snapshot.version;
    return entry;
  }

  /** Returns and clears the recorded domain events. */
  pullDomainEvents(): readonly EventEnvelope[] {
    const events = [...this.#events];
    this.#events.length = 0;
    return events;
  }

  /** Throws when the entry is in a terminal state (cannot be mutated). */
  #assertMutable(action: string): void {
    if (this.#status.isTerminal()) {
      throw new CalendarEntryStateTransitionError(
        `Cannot ${action} a calendar entry in status ${this.#status.value}`,
        { calendarEntryId: this.#id, from: this.#status.value },
      );
    }
  }

  /** Bumps the version and updated-at timestamp (optimistic concurrency). */
  #bump(now = nowIso()): void {
    this.#version += 1;
    this.#updatedAt = now;
  }
}
