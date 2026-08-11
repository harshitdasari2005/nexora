/**
 * @nexora/application-calendar — CreateCalendarEventHandler.
 *
 * The application entry point for scheduling a calendar entry: delegates to
 * the {@link CalendarApplicationService}. The HTTP adapter and the AI tool
 * share this same boundary (one business execution path).
 */

import type { Result } from '@nexora/shared/result';
import type { NexoraError } from '@nexora/shared/errors';
import type { CommandHandler } from '../commands/command-handler.js';

import type {
  CreateCalendarEventCommand,
  CreateCalendarEventResult,
} from '../commands/create-calendar-event.command.js';
import type { CalendarApplicationService } from '../services/calendar-application-service.js';

/** Handles {@link CreateCalendarEventCommand}. */
export class CreateCalendarEventHandler implements CommandHandler<
  CreateCalendarEventCommand,
  CreateCalendarEventResult,
  NexoraError
> {
  readonly #service: CalendarApplicationService;

  constructor(service: CalendarApplicationService) {
    this.#service = service;
  }

  handle(command: CreateCalendarEventCommand): Promise<Result<CreateCalendarEventResult, NexoraError>> {
    return this.#service.createCalendarEvent(command);
  }
}
