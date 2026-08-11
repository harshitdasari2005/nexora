/**
 * @nexora/module-calendar — CalendarEntryStatus value object.
 *
 * The lifecycle status of a {@link CalendarEntry} (DOMAIN_MODEL.md §4.5:
 * a calendar entry is `scheduled` until it is `cancelled`; cancelled is
 * terminal in v1). Transitions are governed by the
 * `CalendarEntryLifecyclePolicy` (docs/BUSINESS_RULES.md).
 */

import { InvalidCalendarEntryValueError } from '../errors/index.js';

/** Calendar-entry lifecycle statuses (DOMAIN_MODEL.md §4.5). */
export const CALENDAR_ENTRY_STATUSES = ['scheduled', 'cancelled'] as const;

/** Single calendar-entry status literal. */
export type CalendarEntryStatusValue = (typeof CALENDAR_ENTRY_STATUSES)[number];

/** The lifecycle status of a calendar entry. Immutable. */
export class CalendarEntryStatus {
  readonly #value: CalendarEntryStatusValue;

  private constructor(value: CalendarEntryStatusValue) {
    this.#value = value;
  }

  /** The entry is on the calendar and visible to attendees. */
  static scheduled(): CalendarEntryStatus {
    return new CalendarEntryStatus('scheduled');
  }

  /** The entry was cancelled (terminal in v1). */
  static cancelled(): CalendarEntryStatus {
    return new CalendarEntryStatus('cancelled');
  }

  /**
   * Creates a {@link CalendarEntryStatus} from a raw string.
   *
   * @param value - one of {@link CALENDAR_ENTRY_STATUSES}.
   * @throws {InvalidCalendarEntryValueError} when the value is unknown.
   */
  static from(value: string): CalendarEntryStatus {
    const member = CALENDAR_ENTRY_STATUSES.find((status) => status === value);
    if (member === undefined) {
      throw new InvalidCalendarEntryValueError('Invalid calendar entry status', [
        { path: 'status', message: `Must be one of: ${CALENDAR_ENTRY_STATUSES.join(', ')}` },
      ]);
    }
    return new CalendarEntryStatus(member);
  }

  /** The status value. */
  get value(): CalendarEntryStatusValue {
    return this.#value;
  }

  /** Whether the entry is currently scheduled (not cancelled). */
  isScheduled(): boolean {
    return this.#value === 'scheduled';
  }

  /** Whether the status is terminal (cancelled). */
  isTerminal(): boolean {
    return this.#value === 'cancelled';
  }

  /** Structural equality against another {@link CalendarEntryStatus}. */
  equals(other: CalendarEntryStatus): boolean {
    return this.#value === other.#value;
  }

  /** Returns the status value. */
  toString(): string {
    return this.#value;
  }
}
