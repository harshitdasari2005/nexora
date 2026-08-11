/**
 * @nexora/module-calendar — EventTimeWindow value object.
 *
 * The time window of a {@link CalendarEntry}: an ISO-8601 UTC `startsAt` and
 * an `endsAt` strictly after the start (a zero-length or backwards window is
 * invalid — the entry would be meaningless on a calendar). Both values are
 * validated as parseable ISO-8601 timestamps (PERSISTENCE.md §6 time value
 * objects).
 */

import { isValidIso } from '@nexora/shared/time';

import { InvalidCalendarEntryValueError } from '../errors/index.js';

/** A validated calendar-entry time window. Immutable. */
export class EventTimeWindow {
  readonly #startsAt: string;
  readonly #endsAt: string;

  private constructor(startsAt: string, endsAt: string) {
    this.#startsAt = startsAt;
    this.#endsAt = endsAt;
  }

  /**
   * Creates an {@link EventTimeWindow} from ISO-8601 UTC timestamps.
   *
   * @throws {InvalidCalendarEntryValueError} when either value is not a
   *         valid ISO timestamp or when `endsAt` is not strictly after
   *         `startsAt`.
   */
  static create(startsAt: string, endsAt: string): EventTimeWindow {
    const issues: { path: string; message: string }[] = [];
    if (!isValidIso(startsAt)) {
      issues.push({ path: 'startsAt', message: 'Must be a valid ISO-8601 timestamp' });
    }
    if (!isValidIso(endsAt)) {
      issues.push({ path: 'endsAt', message: 'Must be a valid ISO-8601 timestamp' });
    }
    if (issues.length === 0 && Date.parse(endsAt) <= Date.parse(startsAt)) {
      issues.push({ path: 'endsAt', message: 'Must be after startsAt' });
    }
    if (issues.length > 0) {
      throw new InvalidCalendarEntryValueError('Invalid event time window', issues);
    }
    return new EventTimeWindow(startsAt, endsAt);
  }

  /** ISO-8601 UTC start instant. */
  get startsAt(): string {
    return this.#startsAt;
  }

  /** ISO-8601 UTC end instant (strictly after {@link EventTimeWindow.startsAt}). */
  get endsAt(): string {
    return this.#endsAt;
  }

  /** Structural equality against another {@link EventTimeWindow}. */
  equals(other: EventTimeWindow): boolean {
    return this.#startsAt === other.#startsAt && this.#endsAt === other.#endsAt;
  }
}
