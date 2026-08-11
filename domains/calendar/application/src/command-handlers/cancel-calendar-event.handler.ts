/**
 * @nexora/application-calendar — CancelCalendarEventHandler.
 *
 * The application entry point for cancelling a calendar entry: delegates to
 * the {@link CalendarApplicationService}.
 */

import type { Result } from '@nexora/shared/result';
import type { NexoraError } from '@nexora/shared/errors';
import type { CommandHandler } from '../commands/command-handler.js';

import type {
  CancelCalendarEventCommand,
  CancelCalendarEventResult,
} from '../commands/cancel-calendar-event.command.js';
import type { CalendarApplicationService } from '../services/calendar-application-service.js';

/** Handles {@link CancelCalendarEventCommand}. */
export class CancelCalendarEventHandler implements CommandHandler<
  CancelCalendarEventCommand,
  CancelCalendarEventResult,
  NexoraError
> {
  readonly #service: CalendarApplicationService;

  constructor(service: CalendarApplicationService) {
    this.#service = service;
  }

  handle(command: CancelCalendarEventCommand): Promise<Result<CancelCalendarEventResult, NexoraError>> {
    return this.#service.cancelCalendarEvent(command);
  }
}
