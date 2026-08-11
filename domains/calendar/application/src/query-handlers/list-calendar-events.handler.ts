/**
 * @nexora/application-calendar — ListCalendarEventsHandler.
 *
 * The application entry point for the workspace-scoped calendar-entry
 * listing query.
 */

import type { Result } from '@nexora/shared/result';
import type { NexoraError } from '@nexora/shared/errors';

import type {
  ListCalendarEventsQuery,
  ListCalendarEventsResult,
} from '../queries/list-calendar-events.query.js';
import type { CalendarApplicationService } from '../services/calendar-application-service.js';

/** Handles {@link ListCalendarEventsQuery}. */
export class ListCalendarEventsHandler {
  readonly #service: CalendarApplicationService;

  constructor(service: CalendarApplicationService) {
    this.#service = service;
  }

  handle(query: ListCalendarEventsQuery): Promise<Result<ListCalendarEventsResult, NexoraError>> {
    return this.#service.listCalendarEvents(query.organizationId, query.workspaceId);
  }
}
