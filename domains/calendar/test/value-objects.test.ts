/**
 * Calendar value-object tests: id validation, title bounds, status
 * membership, and time-window invariants.
 */

import { describe, expect, it } from 'vitest';

import {
  CalendarEntryId,
  CalendarEntryStatus,
  CalendarEntryTitle,
  EventTimeWindow,
} from '../src/index.js';

describe('CalendarEntryId', () => {
  it('creates ids with the cal_ prefix', () => {
    expect(CalendarEntryId.create()).toMatch(/^cal_/);
  });

  it('accepts a previously-created id', () => {
    const id = CalendarEntryId.create();
    expect(CalendarEntryId.from(id)).toBe(id);
  });

  it('rejects malformed ids', () => {
    expect(() => CalendarEntryId.from('not-an-id')).toThrow();
  });
});

describe('CalendarEntryTitle', () => {
  it('trims and stores a title', () => {
    expect(CalendarEntryTitle.create('  Project Review  ').value).toBe('Project Review');
  });

  it('rejects an empty title', () => {
    expect(() => CalendarEntryTitle.create('   ')).toThrow();
  });

  it('rejects an over-long title', () => {
    expect(() => CalendarEntryTitle.create('x'.repeat(121))).toThrow();
  });
});

describe('CalendarEntryStatus', () => {
  it('parses the known statuses', () => {
    expect(CalendarEntryStatus.from('scheduled').value).toBe('scheduled');
    expect(CalendarEntryStatus.from('cancelled').value).toBe('cancelled');
  });

  it('rejects unknown statuses', () => {
    expect(() => CalendarEntryStatus.from('deleted')).toThrow();
  });

  it('flags scheduled vs terminal correctly', () => {
    expect(CalendarEntryStatus.scheduled().isScheduled()).toBe(true);
    expect(CalendarEntryStatus.scheduled().isTerminal()).toBe(false);
    expect(CalendarEntryStatus.cancelled().isScheduled()).toBe(false);
    expect(CalendarEntryStatus.cancelled().isTerminal()).toBe(true);
  });
});

describe('EventTimeWindow', () => {
  it('accepts a strictly-forward window', () => {
    const window = EventTimeWindow.create('2026-09-01T15:00:00.000Z', '2026-09-01T16:00:00.000Z');
    expect(window.startsAt).toBe('2026-09-01T15:00:00.000Z');
    expect(window.endsAt).toBe('2026-09-01T16:00:00.000Z');
  });

  it('rejects a backwards window', () => {
    expect(() =>
      EventTimeWindow.create('2026-09-01T16:00:00.000Z', '2026-09-01T15:00:00.000Z'),
    ).toThrow();
  });

  it('rejects a zero-length window', () => {
    expect(() =>
      EventTimeWindow.create('2026-09-01T15:00:00.000Z', '2026-09-01T15:00:00.000Z'),
    ).toThrow();
  });

  it('rejects invalid ISO timestamps', () => {
    expect(() => EventTimeWindow.create('nope', '2026-09-01T16:00:00.000Z')).toThrow();
    expect(() => EventTimeWindow.create('2026-09-01T15:00:00.000Z', 'nope')).toThrow();
  });
});
