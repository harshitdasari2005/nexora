/**
 * @nexora/application-calendar — CalendarApplicationService.
 *
 * The application layer orchestrator (BACKEND.md §4): it coordinates the
 * CalendarEntryDomainService, verifies every read/write against the trusted
 * tenant + workspace scope, collects emitted domain events, and publishes
 * them once through the {@link EventPublisher} port. It contains no business
 * rules of its own — every invariant is enforced by the domain.
 *
 * Scope (tenant + workspace) is TRUSTED server-side state: a foreign or
 * cross-workspace entry id resolves to NOT FOUND, never to another
 * workspace's entry.
 */

import type { TenantId, WorkspaceId } from '@nexora/contracts/common';
import type { EventPublisher } from '@nexora/shared/events';
import { toNexoraError, type NexoraError } from '@nexora/shared/errors';
import { err, ok, type Result } from '@nexora/shared/result';
import {
  CalendarEntryId,
  CalendarEntryNotFoundError,
  type CalendarEntry,
  type CalendarEntryDomainService,
  type CalendarEventContext,
} from '@nexora/module-calendar';

import type {
  CreateCalendarEventCommand,
  CreateCalendarEventResult,
} from '../commands/create-calendar-event.command.js';
import type {
  UpdateCalendarEventCommand,
  UpdateCalendarEventResult,
} from '../commands/update-calendar-event.command.js';
import type {
  CancelCalendarEventCommand,
  CancelCalendarEventResult,
} from '../commands/cancel-calendar-event.command.js';
import { toCalendarEventDto, type CalendarEventDto } from '../dto/calendar-event.dto.js';
import {
  validateCreateCalendarEvent,
  validateUpdateCalendarEvent,
} from '../validators/create-calendar-event.validator.js';

/** Dependencies of the {@link CalendarApplicationService}. */
export interface CalendarApplicationServiceDependencies {
  /** The calendar-entry lifecycle domain service. */
  entriesService: CalendarEntryDomainService;
  /** Publishes domain events to the platform event stream. */
  publisher: EventPublisher;
}

/**
 * The calendar application service. All methods return a `Result` so
 * expected failures are explicit values.
 */
export class CalendarApplicationService {
  readonly #entriesService: CalendarEntryDomainService;
  readonly #publisher: EventPublisher;

  constructor(dependencies: CalendarApplicationServiceDependencies) {
    this.#entriesService = dependencies.entriesService;
    this.#publisher = dependencies.publisher;
  }

  /**
   * Creates a calendar entry in `scheduled` status within the trusted
   * tenant + workspace and publishes the created event once.
   */
  async createCalendarEvent(
    command: CreateCalendarEventCommand,
  ): Promise<Result<CreateCalendarEventResult, NexoraError>> {
    try {
      validateCreateCalendarEvent(command);
      const context = calendarContext(
        command.actorId,
        command.correlationId,
        command.organizationId,
        command.workspaceId,
      );

      const created = await this.#entriesService.create(
        {
          organizationId: command.organizationId,
          workspaceId: command.workspaceId,
          createdBy: command.createdBy,
          title: command.title,
          startsAt: command.startsAt,
          endsAt: command.endsAt,
        },
        context,
      );
      if (!created.ok) {
        return err(created.error);
      }

      await this.#publisher.publish(created.value.events);
      return ok({
        entry: created.value.entry,
        events: created.value.events,
      });
    } catch (error) {
      return err(toNexoraError(error, 'Unexpected calendar application error'));
    }
  }

  /**
   * Reschedules a calendar entry within the trusted tenant + workspace. A
   * foreign or cross-workspace id resolves to NOT FOUND.
   */
  async updateCalendarEvent(
    command: UpdateCalendarEventCommand,
  ): Promise<Result<UpdateCalendarEventResult, NexoraError>> {
    try {
      validateUpdateCalendarEvent(command);
      const entryId = CalendarEntryId.from(command.calendarEntryId);
      await this.#requireVisibleEntry(entryId, command.organizationId, command.workspaceId);

      const context = calendarContext(
        command.actorId,
        command.correlationId,
        command.organizationId,
        command.workspaceId,
      );
      const updated = await this.#entriesService.reschedule(
        entryId,
        {
          title: command.title,
          startsAt: command.startsAt,
          endsAt: command.endsAt,
        },
        context,
      );
      if (!updated.ok) {
        return err(updated.error);
      }

      await this.#publisher.publish(updated.value.events);
      return ok({
        entry: updated.value.entry,
        events: updated.value.events,
      });
    } catch (error) {
      return err(toNexoraError(error, 'Unexpected calendar application error'));
    }
  }

  /**
   * Cancels a calendar entry within the trusted tenant + workspace. A
   * foreign or cross-workspace id resolves to NOT FOUND.
   */
  async cancelCalendarEvent(
    command: CancelCalendarEventCommand,
  ): Promise<Result<CancelCalendarEventResult, NexoraError>> {
    try {
      const entryId = CalendarEntryId.from(command.calendarEntryId);
      await this.#requireVisibleEntry(entryId, command.organizationId, command.workspaceId);

      const context = calendarContext(
        command.actorId,
        command.correlationId,
        command.organizationId,
        command.workspaceId,
      );
      const cancelled = await this.#entriesService.cancel(entryId, context);
      if (!cancelled.ok) {
        return err(cancelled.error);
      }

      await this.#publisher.publish(cancelled.value.events);
      return ok({
        entry: cancelled.value.entry,
        events: cancelled.value.events,
      });
    } catch (error) {
      return err(toNexoraError(error, 'Unexpected calendar application error'));
    }
  }

  /**
   * Lists the calendar entries of a workspace, newest first (workspace-scoped
   * read — never cross-workspace).
   */
  async listCalendarEvents(
    organizationId: TenantId,
    workspaceId: WorkspaceId,
  ): Promise<Result<readonly CalendarEventDto[], never>> {
    const listed = await this.#entriesService.listByWorkspace(organizationId, workspaceId);
    if (!listed.ok) {
      return err(listed.error);
    }
    return ok(listed.value.map((entry) => toCalendarEventDto(entry)));
  }

  /**
   * Reads one calendar entry within the trusted tenant + workspace, or NOT
   * FOUND.
   */
  async getCalendarEvent(
    organizationId: TenantId,
    workspaceId: WorkspaceId,
    calendarEntryId: string,
  ): Promise<Result<CalendarEventDto, NexoraError>> {
    try {
      const entryId = CalendarEntryId.from(calendarEntryId);
      const entry = await this.#requireVisibleEntry(entryId, organizationId, workspaceId);
      return ok(toCalendarEventDto(entry));
    } catch (error) {
      return err(toNexoraError(error, 'Unexpected calendar application error'));
    }
  }

  /** Loads an entry and asserts it belongs to the trusted tenant + workspace. */
  async #requireVisibleEntry(
    entryId: CalendarEntryId,
    organizationId: TenantId,
    workspaceId: WorkspaceId,
  ): Promise<CalendarEntry> {
    const found = await this.#entriesService.findById(entryId);
    if (!found.ok) {
      throw new CalendarEntryNotFoundError({ calendarEntryId: entryId });
    }
    if (found.value.organizationId !== organizationId || found.value.workspaceId !== workspaceId) {
      // Foreign / cross-workspace entries are invisible: same NOT FOUND
      // outcome as a missing id (no data leak).
      throw new CalendarEntryNotFoundError({ calendarEntryId: entryId });
    }
    return found.value;
  }
}

/** Builds a Calendar event context (tenant + workspace known to caller). */
function calendarContext(
  actorId: string,
  correlationId: string,
  organizationId: TenantId,
  workspaceId: WorkspaceId,
): CalendarEventContext {
  return {
    actor: { kind: 'user', id: actorId },
    correlationId,
    organizationId,
    workspaceId,
  };
}
