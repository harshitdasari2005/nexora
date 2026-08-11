/**
 * @nexora/module-calendar — domain policies.
 *
 * The Calendar bounded context business rules (DOMAIN_MODEL.md §4.5),
 * extracted so the platform can reuse them and so aggregate invariants stay
 * in one authoritative place. Policies are pure: they have no I/O and throw
 * typed domain errors on violation.
 */

import {
  InvalidCalendarEntryValueError,
  CalendarEntryStateTransitionError,
} from '../errors/index.js';
import type { CalendarEntryStatusValue } from '../value-objects/calendar-entry-status.js';
import { type CalendarEntryStatus } from '../value-objects/calendar-entry-status.js';

/**
 * The calendar-entry lifecycle transition table (DOMAIN_MODEL.md §4.5):
 *
 * ```mermaid
 * stateDiagram-v2
 *     [*] --> Scheduled
 *     Scheduled --> Cancelled: cancel (calendar.event.cancelled)
 * ```
 *
 * The single authoritative definition — the CalendarEntry aggregate and all
 * policies consult it. `cancelled` is terminal.
 */
export const CALENDAR_ENTRY_TRANSITIONS: Readonly<
  Record<CalendarEntryStatusValue, readonly CalendarEntryStatusValue[]>
> = {
  scheduled: ['cancelled'],
  cancelled: [],
};

/**
 * Calendar-entry lifecycle rules: allowed status transitions
 * (DOMAIN_MODEL.md §4.5). Every transition must be explicit and validated
 * before mutation.
 */
export class CalendarEntryLifecyclePolicy {
  /** The statuses reachable from the given status. */
  allowedTargets(current: CalendarEntryStatus): readonly CalendarEntryStatusValue[] {
    return CALENDAR_ENTRY_TRANSITIONS[current.value];
  }

  /**
   * Asserts the entry may transition to the target status.
   *
   * @throws {CalendarEntryStateTransitionError} when the transition is not allowed.
   */
  assertCanTransition(current: CalendarEntryStatus, target: CalendarEntryStatus): void {
    const allowed = this.allowedTargets(current);
    if (!allowed.includes(target.value)) {
      throw new CalendarEntryStateTransitionError(
        `Cannot transition a calendar entry from ${current.value} to ${target.value}`,
        { from: current.value, to: target.value },
      );
    }
  }
}

/**
 * Calendar-entry value invariants (DOMAIN_MODEL.md §4.5): a title is
 * required and bounded by the platform name limit; a time window must be a
 * valid, strictly-forward interval (enforced by the EventTimeWindow VO).
 */
export class CalendarEntryValuePolicy {
  /**
   * Asserts a title is non-empty and within the platform name limit.
   *
   * @throws {InvalidCalendarEntryValueError} when the title is empty or too long.
   */
  assertValidTitle(title: string, maxLength = 120): void {
    const value = title.trim();
    const issues: { path: string; message: string }[] = [];
    if (value.length === 0) {
      issues.push({ path: 'title', message: 'Must not be empty' });
    } else if (value.length > maxLength) {
      issues.push({ path: 'title', message: `Must be at most ${maxLength} characters` });
    }
    if (issues.length > 0) {
      throw new InvalidCalendarEntryValueError('Invalid calendar entry title', issues);
    }
  }
}
