/**
 * @nexora/shared — time utilities.
 *
 * The platform stores and exchanges timestamps as ISO-8601 UTC strings
 * (PERSISTENCE.md §6 value objects). These helpers keep that convention
 * consistent and dependency-free.
 */

/** An ISO-8601 timestamp in UTC, e.g. `2026-08-08T12:00:00.000Z`. */
export type IsoTimestamp = string;

/**
 * Returns the current instant as an ISO-8601 UTC timestamp.
 */
export function nowIso(): IsoTimestamp {
  return new Date().toISOString();
}

/**
 * Converts a {@link Date} to an ISO-8601 UTC timestamp.
 */
export function toIso(date: Date): IsoTimestamp {
  return date.toISOString();
}

/**
 * Converts an ISO-8601 timestamp to a {@link Date}.
 *
 * @throws {RangeError} when the value cannot be parsed as a valid date.
 */
export function fromIso(timestamp: IsoTimestamp): Date {
  const parsed = new Date(timestamp);
  if (Number.isNaN(parsed.getTime())) {
    throw new RangeError(`Invalid ISO timestamp: ${JSON.stringify(timestamp)}`);
  }
  return parsed;
}

/**
 * Returns true when the value is a parseable ISO-8601 timestamp.
 */
export function isValidIso(timestamp: string): boolean {
  return !Number.isNaN(Date.parse(timestamp));
}

/**
 * Returns the number of whole seconds between two timestamps.
 * When `later` precedes `earlier`, the result is negative.
 */
export function secondsBetween(later: IsoTimestamp, earlier: IsoTimestamp): number {
  return Math.floor((Date.parse(later) - Date.parse(earlier)) / 1_000);
}

/**
 * Returns the number of whole milliseconds between two timestamps.
 */
export function millisBetween(later: IsoTimestamp, earlier: IsoTimestamp): number {
  return Date.parse(later) - Date.parse(earlier);
}

/**
 * Returns a new timestamp `ms` milliseconds after the given one.
 */
export function addMillis(timestamp: IsoTimestamp, ms: number): IsoTimestamp {
  return new Date(Date.parse(timestamp) + ms).toISOString();
}
