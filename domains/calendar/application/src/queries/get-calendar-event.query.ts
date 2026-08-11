/**
 * @nexora/application-calendar — GetCalendarEvent query.
 *
 * Single calendar-entry read within the trusted tenant + workspace. A
 * foreign or cross-workspace entry id resolves to NOT FOUND, never to
 * another workspace's entry.
 */

import type { TenantId, WorkspaceId } from '@nexora/contracts/common';

import type { CalendarEventDto } from '../dto/calendar-event.dto.js';

/** Reads one calendar entry. */
export interface GetCalendarEventQuery {
  /** The entry id. */
  calendarEntryId: string;
  /** The owning organization (tenant) id. */
  organizationId: TenantId;
  /** The owning workspace id. */
  workspaceId: WorkspaceId;
}

/** The result of {@link GetCalendarEventQuery}. */
export type GetCalendarEventResult = CalendarEventDto;
