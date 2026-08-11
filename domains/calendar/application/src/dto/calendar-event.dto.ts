/**
 * @nexora/application-calendar — calendar event DTO.
 *
 * The public representation of a calendar entry returned by queries and
 * APIs. Internal aggregates never cross module boundaries.
 */

import type { CalendarEntry } from '@nexora/module-calendar';

/** The public calendar-entry representation. */
export interface CalendarEventDto {
  /** The entry id. */
  id: string;
  /** The owning organization (tenant) id. */
  organizationId: string;
  /** The owning workspace id. */
  workspaceId: string;
  /** The user that created the entry. */
  createdBy: string;
  /** The title. */
  title: string;
  /** ISO-8601 UTC start instant. */
  startsAt: string;
  /** ISO-8601 UTC end instant. */
  endsAt: string;
  /** The lifecycle status (`scheduled` | `cancelled`). */
  status: string;
  /** ISO-8601 UTC creation time. */
  createdAt: string;
}

/** Maps a {@link CalendarEntry} aggregate to its {@link CalendarEventDto}. */
export function toCalendarEventDto(entry: CalendarEntry): CalendarEventDto {
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
  };
}
