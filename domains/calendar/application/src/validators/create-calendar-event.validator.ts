/**
 * @nexora/application-calendar — CreateCalendarEvent validator.
 *
 * Structural validation of the create-calendar-event command before the use
 * case runs. Deep domain validation (title VO, time window VO) remains the
 * responsibility of the domain layer — this validator only rejects malformed
 * command input early (API_CONTRACTS.md §10 errors).
 */

import { ValidationError, type FieldIssue } from '@nexora/shared/errors';

import type { CreateCalendarEventCommand } from '../commands/create-calendar-event.command.js';

/** Maximum calendar-entry title length accepted by the API (mirrors the domain). */
export const MAX_CALENDAR_EVENT_TITLE_LENGTH = 120;

/**
 * Validates a {@link CreateCalendarEventCommand}.
 *
 * @throws {ValidationError} when the command is malformed.
 */
export function validateCreateCalendarEvent(command: CreateCalendarEventCommand): void {
  const issues: FieldIssue[] = [];

  if (command.title.trim().length === 0) {
    issues.push({ path: 'title', message: 'Must not be empty' });
  } else if (command.title.trim().length > MAX_CALENDAR_EVENT_TITLE_LENGTH) {
    issues.push({
      path: 'title',
      message: `Must be at most ${MAX_CALENDAR_EVENT_TITLE_LENGTH} characters`,
    });
  }

  if (issues.length > 0) {
    throw new ValidationError('Invalid calendar event request', issues);
  }
}

/**
 * Validates the reschedule fields of an {@link UpdateCalendarEventCommand}
 * (shared with create — the same domain invariants apply).
 *
 * @throws {ValidationError} when the command is malformed.
 */
export function validateUpdateCalendarEvent(command: {
  title: string;
  startsAt: string;
  endsAt: string;
}): void {
  const issues: FieldIssue[] = [];

  if (command.title.trim().length === 0) {
    issues.push({ path: 'title', message: 'Must not be empty' });
  } else if (command.title.trim().length > MAX_CALENDAR_EVENT_TITLE_LENGTH) {
    issues.push({
      path: 'title',
      message: `Must be at most ${MAX_CALENDAR_EVENT_TITLE_LENGTH} characters`,
    });
  }

  if (issues.length > 0) {
    throw new ValidationError('Invalid calendar event request', issues);
  }
}
