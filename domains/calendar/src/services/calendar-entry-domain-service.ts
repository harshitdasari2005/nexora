/**
 * @nexora/module-calendar — CalendarEntryDomainService.
 *
 * Orchestrates the {@link CalendarEntry} aggregate lifecycle (DOMAIN_MODEL.md
 * §4.5): creation, rescheduling, and cancellation. Owns the use-case
 * workflows that span the aggregate and its repository; the aggregate
 * enforces its own invariants. All methods return a `Result` so expected
 * failures are explicit values, not exceptions.
 */

import type { EventEnvelope } from '@nexora/shared/events';
import type { Result } from '@nexora/shared/result';
import { ok, err } from '@nexora/shared/result';
import type { TenantId, UserId, WorkspaceId } from '@nexora/contracts/common';

import { CalendarEntry } from '../entities/calendar-entry.js';
import type { CalendarEventContext } from '../events/index.js';
import {
  CalendarEntryNotFoundError,
  toCalendarError,
  type CalendarEntryStateTransitionError,
  type InvalidCalendarEntryValueError,
} from '../errors/index.js';
import { CalendarEntryLifecyclePolicy, CalendarEntryValuePolicy } from '../policies/index.js';
import type { CalendarEntryRepository } from '../repositories/index.js';
import type { CalendarEntryId } from '../value-objects/calendar-entry-id.js';
import { CalendarEntryStatus } from '../value-objects/calendar-entry-status.js';

/** Input for creating a calendar entry. */
export interface CreateCalendarEntryCommand {
  /** The owning organization (tenant) id. */
  organizationId: TenantId;
  /** The owning workspace id. */
  workspaceId: WorkspaceId;
  /** The user that creates the entry. */
  createdBy: UserId;
  /** The entry title. */
  title: string;
  /** ISO-8601 UTC start instant. */
  startsAt: string;
  /** ISO-8601 UTC end instant. */
  endsAt: string;
}

/** Input for rescheduling a calendar entry. */
export interface RescheduleCalendarEntryCommand {
  /** The entry title. */
  title: string;
  /** ISO-8601 UTC start instant. */
  startsAt: string;
  /** ISO-8601 UTC end instant. */
  endsAt: string;
}

/** The outcome of a calendar-entry command: the aggregate plus emitted events. */
export interface CalendarEntryCommandResult {
  /** The mutated aggregate. */
  entry: CalendarEntry;
  /** Domain events emitted by the operation (publish via the event bus). */
  events: readonly EventEnvelope[];
}

/** Dependencies of the {@link CalendarEntryDomainService}. */
export interface CalendarEntryDomainServiceDependencies {
  /** Calendar-entry persistence. */
  entries: CalendarEntryRepository;
  /** Lifecycle policy (status transitions). */
  lifecycle?: CalendarEntryLifecyclePolicy;
}

/**
 * The calendar-entry lifecycle use-case service.
 */
export class CalendarEntryDomainService {
  readonly #entries: CalendarEntryRepository;
  readonly #lifecycle: CalendarEntryLifecyclePolicy;
  readonly #values: CalendarEntryValuePolicy;

  constructor(dependencies: CalendarEntryDomainServiceDependencies) {
    this.#entries = dependencies.entries;
    this.#lifecycle = dependencies.lifecycle ?? new CalendarEntryLifecyclePolicy();
    this.#values = new CalendarEntryValuePolicy();
  }

  /**
   * Creates a calendar entry: validates the input through the aggregate
   * factory, persists it in `scheduled`, and returns the aggregate plus its
   * events.
   */
  async create(
    input: CreateCalendarEntryCommand,
    context: CalendarEventContext,
  ): Promise<Result<CalendarEntryCommandResult, InvalidCalendarEntryValueError>> {
    try {
      // Policy pre-check (fail fast before any state exists) — the aggregate
      // factory re-validates through the value-object constructors, so this
      // is defense-in-depth, not the single enforcement point.
      this.#values.assertValidTitle(input.title);
      const entry = CalendarEntry.create(
        {
          organizationId: input.organizationId,
          workspaceId: input.workspaceId,
          createdBy: input.createdBy,
          title: input.title,
          startsAt: input.startsAt,
          endsAt: input.endsAt,
        },
        context,
      );
      await this.#entries.save(entry);
      return ok({ entry, events: entry.pullDomainEvents() });
    } catch (error) {
      return err(toCalendarError(error) as InvalidCalendarEntryValueError);
    }
  }

  /**
   * Reschedules an entry while it is still `scheduled` (new title / window).
   */
  async reschedule(
    entryId: CalendarEntryId,
    input: RescheduleCalendarEntryCommand,
    context: CalendarEventContext,
  ): Promise<
    Result<
      CalendarEntryCommandResult,
      CalendarEntryNotFoundError | CalendarEntryStateTransitionError
    >
  > {
    try {
      const entry = await this.#requireEntry(entryId);
      // Rescheduling does NOT change the status — the aggregate enforces the
      // "cancelled entries cannot be mutated" invariant itself (#assertMutable).
      entry.reschedule(input, context);
      await this.#entries.save(entry);
      return ok({ entry, events: entry.pullDomainEvents() });
    } catch (error) {
      return err(
        toCalendarError(error) as CalendarEntryNotFoundError | CalendarEntryStateTransitionError,
      );
    }
  }

  /**
   * Cancels an entry (`scheduled` → `cancelled` — terminal).
   */
  async cancel(
    entryId: CalendarEntryId,
    context: CalendarEventContext,
  ): Promise<
    Result<
      CalendarEntryCommandResult,
      CalendarEntryNotFoundError | CalendarEntryStateTransitionError
    >
  > {
    try {
      const entry = await this.#requireEntry(entryId);
      this.#lifecycle.assertCanTransition(entry.status, CalendarEntryStatus.cancelled());
      entry.cancel(context);
      await this.#entries.save(entry);
      return ok({ entry, events: entry.pullDomainEvents() });
    } catch (error) {
      return err(
        toCalendarError(error) as CalendarEntryNotFoundError | CalendarEntryStateTransitionError,
      );
    }
  }

  /** Finds an entry by id, or returns a {@link CalendarEntryNotFoundError}. */
  async findById(
    entryId: CalendarEntryId,
  ): Promise<Result<CalendarEntry, CalendarEntryNotFoundError>> {
    const entry = await this.#entries.findById(entryId);
    if (entry === undefined) {
      return err(new CalendarEntryNotFoundError({ calendarEntryId: entryId }));
    }
    return ok(entry);
  }

  /** Lists the entries of a workspace (workspace-scoped read). */
  async listByWorkspace(
    organizationId: TenantId,
    workspaceId: WorkspaceId,
  ): Promise<Result<readonly CalendarEntry[], never>> {
    return ok(await this.#entries.listByWorkspace(organizationId, workspaceId));
  }

  /** Loads an entry or throws {@link CalendarEntryNotFoundError}. */
  async #requireEntry(entryId: CalendarEntryId): Promise<CalendarEntry> {
    const entry = await this.#entries.findById(entryId);
    if (entry === undefined) {
      throw new CalendarEntryNotFoundError({ calendarEntryId: entryId });
    }
    return entry;
  }
}
