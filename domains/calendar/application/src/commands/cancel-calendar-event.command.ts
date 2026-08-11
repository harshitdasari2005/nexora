/**
 * @nexora/application-calendar — CancelCalendarEvent command.
 *
 * The vertical-slice use case that cancels a calendar entry (`scheduled` →
 * `cancelled`, terminal). The organization and workspace are TRUSTED
 * server-side scope: a foreign or cross-workspace entry id resolves to NOT
 * FOUND, never to another workspace's entry.
 */

import type { TenantId, UserId, WorkspaceId } from '@nexora/contracts/common';
import type { EventEnvelope } from '@nexora/shared/events';

import type { CalendarEntry } from '@nexora/module-calendar';

/** Cancels a calendar entry. */
export interface CancelCalendarEventCommand {
  /** The entry id. */
  calendarEntryId: string;
  /** The owning organization (tenant) id (trusted scope). */
  organizationId: TenantId;
  /** The owning workspace id (trusted scope). */
  workspaceId: WorkspaceId;
  /** The user acting (event actor). */
  actorId: UserId;
  /** Correlation id of the originating execution. */
  correlationId: string;
}

/** The outcome of a successful calendar-entry cancellation. */
export interface CancelCalendarEventResult {
  /** The cancelled calendar entry aggregate. */
  entry: CalendarEntry;
  /** Domain events emitted by the use case (calendar.event.cancelled). */
  events: readonly EventEnvelope[];
}
