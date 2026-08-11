/**
 * @nexora/application-calendar — UpdateCalendarEvent command.
 *
 * The vertical-slice use case that reschedules a calendar entry (new title /
 * time window) while it is still `scheduled`. The organization and workspace
 * are TRUSTED server-side scope: a foreign or cross-workspace entry id
 * resolves to NOT FOUND, never to another workspace's entry.
 */

import type { TenantId, UserId, WorkspaceId } from '@nexora/contracts/common';
import type { EventEnvelope } from '@nexora/shared/events';

import type { CalendarEntry } from '@nexora/module-calendar';

/** Reschedules a calendar entry (title + time window). */
export interface UpdateCalendarEventCommand {
  /** The entry id. */
  calendarEntryId: string;
  /** The owning organization (tenant) id (trusted scope). */
  organizationId: TenantId;
  /** The owning workspace id (trusted scope). */
  workspaceId: WorkspaceId;
  /** The new entry title. */
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

/** The outcome of a successful calendar-entry update. */
export interface UpdateCalendarEventResult {
  /** The updated calendar entry aggregate. */
  entry: CalendarEntry;
  /** Domain events emitted by the use case (calendar.event.updated). */
  events: readonly EventEnvelope[];
}
