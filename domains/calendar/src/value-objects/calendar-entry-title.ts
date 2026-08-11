/**
 * @nexora/module-calendar — CalendarEntryTitle value object.
 *
 * The human-readable title of a {@link CalendarEntry}. Trimmed, non-empty,
 * bounded by the platform name limit (constants `MAX_NAME_LENGTH`).
 */

import { maxLength, required } from '@nexora/shared/validation';
import { MAX_NAME_LENGTH } from '@nexora/shared/constants';

import { InvalidCalendarEntryValueError } from '../errors/index.js';

/** A validated calendar-entry title. Immutable. */
export class CalendarEntryTitle {
  readonly #value: string;

  private constructor(value: string) {
    this.#value = value;
  }

  /**
   * Creates a {@link CalendarEntryTitle} from a raw string.
   *
   * @param input - the raw title (trimmed here).
   * @throws {InvalidCalendarEntryValueError} when the title is empty or too long.
   */
  static create(input: string): CalendarEntryTitle {
    const value = input.trim();
    const issues: { path: string; message: string }[] = [];
    const requiredIssue = required('title', value);
    if (requiredIssue !== null) {
      issues.push(requiredIssue);
    }
    const lengthIssue = maxLength('title', value, MAX_NAME_LENGTH);
    if (lengthIssue !== null) {
      issues.push(lengthIssue);
    }
    if (issues.length > 0) {
      throw new InvalidCalendarEntryValueError('Invalid calendar entry title', issues);
    }
    return new CalendarEntryTitle(value);
  }

  /** The normalized (trimmed) calendar-entry title. */
  get value(): string {
    return this.#value;
  }

  /** Structural equality against another {@link CalendarEntryTitle}. */
  equals(other: CalendarEntryTitle): boolean {
    return this.#value === other.#value;
  }

  /** Returns the title. */
  toString(): string {
    return this.#value;
  }
}
