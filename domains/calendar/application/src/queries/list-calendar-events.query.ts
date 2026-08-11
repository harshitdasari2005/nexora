/**
 * @nexora/application-calendar — ListCalendarEvents query.
 *
 * Workspace-scoped calendar-entry listing (CQRS read side; BACKEND.md §8).
 * The organization + workspace are the trusted scope — the query never
 * returns another workspace's entries.
 */

import type { TenantId, WorkspaceId } from '@nexora/contracts/common';

import type { CalendarEventDto } from '../dto/calendar-event.dto.js';

/** Lists the calendar entries of a workspace. */
export interface ListCalendarEventsQuery {
  /** The owning organization (tenant) id. */
  organizationId: TenantId;
  /** The owning workspace id. */
  workspaceId: WorkspaceId;
}

/** The result of {@link ListCalendarEventsQuery}. */
export type ListCalendarEventsResult = readonly CalendarEventDto[];
