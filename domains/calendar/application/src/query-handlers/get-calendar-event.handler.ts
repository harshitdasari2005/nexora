/**
 * @nexora/application-calendar — GetCalendarEventHandler.
 *
 * The application entry point for the single calendar-entry read query.
 */

import type { Result } from '@nexora/shared/result';
import type { NexoraError } from '@nexora/shared/errors';

import type {
  GetCalendarEventQuery,
  GetCalendarEventResult,
} from '../queries/get-calendar-event.query.js';
import type { CalendarApplicationService } from '../services/calendar-application-service.js';

/** Handles {@link GetCalendarEventQuery}. */
export class GetCalendarEventHandler {
  readonly #service: CalendarApplicationService;

  constructor(service: CalendarApplicationService) {
    this.#service = service;
  }

  handle(query: GetCalendarEventQuery): Promise<Result<GetCalendarEventResult, NexoraError>> {
    return this.#service.getCalendarEvent(
      query.organizationId,
      query.workspaceId,
      query.calendarEntryId,
    );
  }
}
