/**
 * @nexora/application-calendar — CreateCalendarEvent command.
 *
 * The vertical-slice use case that schedules a calendar entry in a workspace
 * (DOMAIN_MODEL.md §4.5): the entry is created in `scheduled` status. The
 * organization (tenant) and workspace are TRUSTED server-side scope — the
 * HTTP route and the AI tool both supply them from the authenticated
 * context, never from client/model input.
 */

import type { TenantId, UserId, WorkspaceId } from '@nexora/contracts/common';
import type { EventEnvelope } from '@nexora/shared/events';

import type { CalendarEntry } from '@nexora/module-calendar';

/** Schedules a new calendar entry in a workspace. */
export interface CreateCalendarEventCommand {
  /** The owning organization (tenant) id (trusted scope). */
  organizationId: TenantId;
  /** The owning workspace id (trusted scope). */
  workspaceId: WorkspaceId;
  /** The user that creates the entry. */
  createdBy: UserId;
  /** The entry title. */
  title: string;
  /** ISO-8601 UTC start instant. */
  startsAt: string;
  /** ISO-8601 UTC end instant. */
  endsAt: string;
  /** The user acting (event actor). */
  actorId: UserId;
  /** Correlation id of the originating execution. */
  correlationId: string;
}

/** The outcome of a successful calendar-entry creation. */
export interface CreateCalendarEventResult {
  /** The created (scheduled) calendar entry aggregate. */
  entry: CalendarEntry;
  /** Domain events emitted by the use case (calendar.event.created). */
  events: readonly EventEnvelope[];
}
