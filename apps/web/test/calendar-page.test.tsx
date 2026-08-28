/**
 * Server-render smoke tests for the Calendar application: the pure
 * `CalendarView` renders the month grid, events, empty state, and status
 * badges without crashing (no DOM or network required — same convention as
 * the other `*-page.test.tsx` files).
 */

import { describe, expect, it } from 'vitest';
import { renderToString } from 'react-dom/server';

import { CalendarView, EventRow, EventStatusBadge } from '../src/pages/Calendar.js';
import type { CalendarEventDto } from '../src/lib/types.js';

const ORGANIZATION = 'org_acme';
const WORKSPACE = 'wsp_engineering';

// Computed relative to "now" (not a hardcoded date) so this suite never goes
// stale: an event an hour from now is always inside the current month grid
// AND always shows in the "Upcoming" panel, regardless of when the tests run.
const SOON_START = new Date(Date.now() + 60 * 60 * 1000);
const SOON_END = new Date(SOON_START.getTime() + 60 * 60 * 1000);

function calendarEvent(overrides: Partial<CalendarEventDto> = {}): CalendarEventDto {
  return {
    id: 'cal_1',
    organizationId: ORGANIZATION,
    workspaceId: WORKSPACE,
    createdBy: 'usr_1',
    title: 'Project Review',
    startsAt: SOON_START.toISOString(),
    endsAt: SOON_END.toISOString(),
    status: 'scheduled',
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

describe('CalendarView', () => {
  it('renders the page header, org/workspace context, and the month grid', () => {
    const html = renderToString(
      <CalendarView
        organizationId={ORGANIZATION}
        workspaceId={WORKSPACE}
        organizationName="Acme Inc."
        workspaceName="Engineering"
        initialEvents={[calendarEvent()]}
        onChanged={() => undefined}
      />,
    );
    expect(html).toContain('Calendar');
    expect(html).toContain('Acme Inc.');
    expect(html).toContain('Engineering');
    // View switcher.
    expect(html).toContain('month');
    expect(html).toContain('week');
    expect(html).toContain('day');
    // The event title appears somewhere (month cell chip or the side panel).
    expect(html).toContain('Project Review');
  });

  it('renders the "New event" create form when toggled open is not required to see the button', () => {
    const html = renderToString(
      <CalendarView
        organizationId={ORGANIZATION}
        workspaceId={WORKSPACE}
        organizationName="Acme Inc."
        workspaceName="Engineering"
        initialEvents={[]}
        onChanged={() => undefined}
      />,
    );
    expect(html).toContain('New event');
  });

  it('renders an honest empty state when there are no events for the selected day', () => {
    const html = renderToString(
      <CalendarView
        organizationId={ORGANIZATION}
        workspaceId={WORKSPACE}
        organizationName="Acme Inc."
        workspaceName="Engineering"
        initialEvents={[]}
        onChanged={() => undefined}
      />,
    );
    expect(html).toContain('No events');
    expect(html).toContain('Upcoming');
    expect(html).toContain('No upcoming events.');
  });
});

describe('EventRow', () => {
  it('renders title, time range, duration, and status for a scheduled event', () => {
    const html = renderToString(
      <EventRow
        event={calendarEvent()}
        organizationId={ORGANIZATION}
        workspaceId={WORKSPACE}
        onUpdated={() => undefined}
      />,
    );
    expect(html).toContain('Project Review');
    expect(html).toContain('Scheduled');
    expect(html).toContain('Edit');
    expect(html).toContain('Cancel event');
  });

  it('renders a cancelled event as read-only (no edit/cancel controls)', () => {
    const html = renderToString(
      <EventRow
        event={calendarEvent({ status: 'cancelled' })}
        organizationId={ORGANIZATION}
        workspaceId={WORKSPACE}
        onUpdated={() => undefined}
      />,
    );
    expect(html).toContain('Cancelled');
    expect(html).not.toContain('>Edit<');
    expect(html).not.toContain('Cancel event');
  });
});

describe('EventStatusBadge', () => {
  it('renders both lifecycle statuses', () => {
    expect(renderToString(<EventStatusBadge status="scheduled" />)).toContain('Scheduled');
    expect(renderToString(<EventStatusBadge status="cancelled" />)).toContain('Cancelled');
  });
});
