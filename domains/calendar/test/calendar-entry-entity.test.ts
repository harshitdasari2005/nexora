/**
 * CalendarEntry aggregate tests: creation, guarded lifecycle transitions,
 * event recording, snapshot/hydrate round-trips (DOMAIN_MODEL.md §4.5).
 */

import { describe, expect, it } from 'vitest';

import { CalendarEntry, CalendarEntryStateTransitionError } from '../src/index.js';
import { TENANT, WORKSPACE, USER, futureWindow, userContext } from './helpers.js';

/** Creates a scheduled entry with events pulled (ready for mutations). */
function scheduledEntry(): CalendarEntry {
  const entry = CalendarEntry.create(
    {
      organizationId: TENANT,
      workspaceId: WORKSPACE,
      createdBy: USER,
      title: 'Project Review',
      ...futureWindow(),
    },
    userContext(),
  );
  entry.pullDomainEvents();
  return entry;
}

describe('CalendarEntry.create', () => {
  it('creates a scheduled entry with a valid id, scope, title, and window', () => {
    const entry = CalendarEntry.create(
      {
        organizationId: TENANT,
        workspaceId: WORKSPACE,
        createdBy: USER,
        title: '  Project Review  ',
        ...futureWindow(),
      },
      userContext(),
    );
    expect(entry.id).toMatch(/^cal_/);
    expect(entry.organizationId).toBe(TENANT);
    expect(entry.workspaceId).toBe(WORKSPACE);
    expect(entry.createdBy).toBe(USER);
    expect(entry.title.value).toBe('Project Review');
    expect(entry.timeWindow.startsAt).toBe('2026-09-01T15:00:00.000Z');
    expect(entry.timeWindow.endsAt).toBe('2026-09-01T16:00:00.000Z');
    expect(entry.status.value).toBe('scheduled');
    expect(entry.version).toBe(1);
    expect(entry.isScheduled()).toBe(true);
  });

  it('records a single calendar.event.created event with envelope context', () => {
    const context = userContext(USER, TENANT, WORKSPACE, 'corr_1');
    const entry = CalendarEntry.create(
      {
        organizationId: TENANT,
        workspaceId: WORKSPACE,
        createdBy: USER,
        title: 'Project Review',
        ...futureWindow(),
      },
      context,
    );
    const events = entry.pullDomainEvents();
    expect(events).toHaveLength(1);
    expect(events[0]?.type).toBe('calendar.event.created');
    expect(events[0]?.correlationId).toBe('corr_1');
    expect(events[0]?.tenantId).toBe(TENANT);
    // The workspace scope rides the envelope (notification policy scoping).
    expect(events[0]?.workspaceId).toBe(WORKSPACE);
    expect((events[0]?.payload as { title: string }).title).toBe('Project Review');
  });

  it('rejects an empty title before any state exists (no partial aggregate)', () => {
    expect(() =>
      CalendarEntry.create(
        {
          organizationId: TENANT,
          workspaceId: WORKSPACE,
          createdBy: USER,
          title: '   ',
          ...futureWindow(),
        },
        userContext(),
      ),
    ).toThrow();
  });

  it('rejects a backwards/zero-length time window before any state exists', () => {
    expect(() =>
      CalendarEntry.create(
        {
          organizationId: TENANT,
          workspaceId: WORKSPACE,
          createdBy: USER,
          title: 'Project Review',
          startsAt: '2026-09-01T16:00:00.000Z',
          endsAt: '2026-09-01T15:00:00.000Z',
        },
        userContext(),
      ),
    ).toThrow();
  });

  it('rejects an invalid ISO timestamp in the window', () => {
    expect(() =>
      CalendarEntry.create(
        {
          organizationId: TENANT,
          workspaceId: WORKSPACE,
          createdBy: USER,
          title: 'Project Review',
          startsAt: 'not-a-date',
          endsAt: '2026-09-01T16:00:00.000Z',
        },
        userContext(),
      ),
    ).toThrow();
  });
});

describe('CalendarEntry lifecycle transitions', () => {
  it('reschedules a scheduled entry (title + window) and records an updated event', () => {
    const entry = scheduledEntry();
    entry.reschedule(
      { title: 'Mobile Banking Review', startsAt: '2026-09-02T10:00:00.000Z', endsAt: '2026-09-02T11:00:00.000Z' },
      userContext(),
    );
    expect(entry.title.value).toBe('Mobile Banking Review');
    expect(entry.timeWindow.startsAt).toBe('2026-09-02T10:00:00.000Z');
    expect(entry.version).toBe(2);
    const events = entry.pullDomainEvents();
    expect(events.map((event) => event.type)).toEqual(['calendar.event.updated']);
  });

  it('cancels a scheduled entry (terminal) and records a cancelled event', () => {
    const entry = scheduledEntry();
    entry.cancel(userContext());
    expect(entry.status.value).toBe('cancelled');
    expect(entry.isScheduled()).toBe(false);
    const events = entry.pullDomainEvents();
    expect(events.map((event) => event.type)).toEqual(['calendar.event.cancelled']);
  });

  it('cannot reschedule or cancel a cancelled entry', () => {
    const entry = scheduledEntry();
    entry.cancel(userContext());
    entry.pullDomainEvents();
    expect(() =>
      entry.reschedule(
        { title: 'Late', startsAt: '2026-09-03T10:00:00.000Z', endsAt: '2026-09-03T11:00:00.000Z' },
        userContext(),
      ),
    ).toThrow(CalendarEntryStateTransitionError);
    expect(() => entry.cancel(userContext())).toThrow(CalendarEntryStateTransitionError);
  });

  it('cannot cancel twice', () => {
    const entry = scheduledEntry();
    entry.cancel(userContext());
    expect(() => entry.cancel(userContext())).toThrow(CalendarEntryStateTransitionError);
  });

  it('no partial mutation on a failed reschedule (title/window/version unchanged)', () => {
    const entry = scheduledEntry();
    const before = entry.version;
    expect(() =>
      entry.reschedule(
        { title: '', startsAt: '2026-09-03T10:00:00.000Z', endsAt: '2026-09-03T11:00:00.000Z' },
        userContext(),
      ),
    ).toThrow();
    expect(entry.title.value).toBe('Project Review');
    expect(entry.version).toBe(before);
  });
});

describe('CalendarEntry snapshot / hydrate', () => {
  it('round-trips through snapshot and hydrate without re-emitting events', () => {
    const entry = scheduledEntry();
    entry.reschedule(
      { title: 'Mobile Banking Review', startsAt: '2026-09-02T10:00:00.000Z', endsAt: '2026-09-02T11:00:00.000Z' },
      userContext(),
    );
    entry.cancel(userContext());
    const snapshot = CalendarEntry.snapshot(entry);

    const restored = CalendarEntry.hydrate(snapshot);
    expect(restored.id).toBe(entry.id);
    expect(restored.organizationId).toBe(entry.organizationId);
    expect(restored.workspaceId).toBe(entry.workspaceId);
    expect(restored.createdBy).toBe(entry.createdBy);
    expect(restored.title.value).toBe('Mobile Banking Review');
    expect(restored.timeWindow.startsAt).toBe('2026-09-02T10:00:00.000Z');
    expect(restored.status.value).toBe('cancelled');
    expect(restored.version).toBe(entry.version);
    expect(restored.pullDomainEvents()).toEqual([]);
  });

  it('hydrate re-validates values at load', () => {
    const entry = scheduledEntry();
    expect(() =>
      CalendarEntry.hydrate({
        ...CalendarEntry.snapshot(entry),
        title: 'x'.repeat(121),
      }),
    ).toThrow();
  });
});
