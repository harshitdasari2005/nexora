/**
 * @nexora/application-calendar — UpdateCalendarEventHandler.
 *
 * The application entry point for rescheduling a calendar entry: delegates
 * to the {@link CalendarApplicationService}.
 */

import type { Result } from '@nexora/shared/result';
import type { NexoraError } from '@nexora/shared/errors';
import type { CommandHandler } from '../commands/command-handler.js';

import type {
  UpdateCalendarEventCommand,
  UpdateCalendarEventResult,
} from '../commands/update-calendar-event.command.js';
import type { CalendarApplicationService } from '../services/calendar-application-service.js';

/** Handles {@link UpdateCalendarEventCommand}. */
export class UpdateCalendarEventHandler implements CommandHandler<
  UpdateCalendarEventCommand,
  UpdateCalendarEventResult,
  NexoraError
> {
  readonly #service: CalendarApplicationService;

  constructor(service: CalendarApplicationService) {
    this.#service = service;
  }

  handle(
    command: UpdateCalendarEventCommand,
  ): Promise<Result<UpdateCalendarEventResult, NexoraError>> {
    return this.#service.updateCalendarEvent(command);
  }
}
