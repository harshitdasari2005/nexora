/**
 * @nexora/module-calendar — CalendarEntryId value object.
 *
 * The identity of a {@link CalendarEntry} (contracts `EntityId<'calendar_entry'>`).
 * Values are branded strings (`cal_...`) created with `@nexora/shared/ids`
 * {@link prefixedId} (PERSISTENCE.md §1 aggregate ownership).
 */

import type { EntityId } from '@nexora/contracts/common';
import { prefixedId } from '@nexora/shared/ids';

import { InvalidCalendarEntryValueError } from '../errors/index.js';

/**
 * CalendarEntry id literal pattern: `cal_` + RFC-4122 UUID v4 (the
 * `prefixedId` shape).
 */
const CALENDAR_ENTRY_ID_PATTERN = /^cal_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * A branded calendar-entry id. Strings with this brand satisfy the type;
 * values are produced by the {@link CalendarEntryId} namespace below or by
 * infrastructure reconstruction via {@link CalendarEntryId.from}.
 */
export type CalendarEntryId = EntityId<'calendar_entry'>;

/**
 * Factory for {@link CalendarEntryId} values. The type and namespace share a
 * name so call sites read naturally: `CalendarEntryId.create()`.
 */
export const CalendarEntryId = {
  /** Generates a new unique calendar-entry id (`cal_...`). */
  create(): CalendarEntryId {
    return prefixedId('cal') as CalendarEntryId;
  },

  /**
   * Reconstructs a {@link CalendarEntryId} from a stored string
   * (infrastructure boundary).
   *
   * @param value - an id previously produced by {@link CalendarEntryId.create}.
   * @throws {InvalidCalendarEntryValueError} when the value is not a valid id.
   */
  from(value: string): CalendarEntryId {
    if (!CALENDAR_ENTRY_ID_PATTERN.test(value)) {
      throw new InvalidCalendarEntryValueError('Invalid calendar entry id', [
        { path: 'calendarEntryId', message: 'Must be a valid calendar entry id' },
      ]);
    }
    return value as CalendarEntryId;
  },
};
