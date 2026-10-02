/**
 * @nexora/app-web — Calendar page.
 *
 * The Calendar workspace view (Calendar vertical slice): month/week/day
 * navigation over the workspace's calendar entries, a create-event flow, and
 * inline edit/cancel — all through the SAME REST surface the AI's
 * `calendar.create_event` tool uses (`/api/calendar/events`). The backend
 * supports exactly five operations (create, list, get, reschedule, cancel)
 * over one shape (`title`, `startsAt`, `endsAt`, `status`) — there is no
 * description, location, attendee, or recurrence field, so none is rendered
 * or collected here. A cancelled entry is terminal (the backend rejects any
 * further reschedule with 422): the UI shows it read-only, never a fake
 * "reopen" control.
 *
 * RBAC (P0 hardening): only a role holding `calendar.read`/`calendar.create`
 * can reach this data — the sidebar hides "Calendar" for every other role
 * (`lib/modules.ts`), and this page's own fetch calls fail closed with a 403
 * the same way every other RBAC'd surface does (never a redesign of the
 * error path).
 */

import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  Field,
  Input,
  Skeleton,
  Stack,
  typography,
} from '@nexora/design-system';

import { AppShell } from '../components/AppShell.js';
import { ErrorState } from '../components/ErrorState.js';
import { LoadingScreen } from '../components/LoadingScreen.js';
import { api, ApiError } from '../lib/api.js';
import type { CalendarEventDto, DashboardResponse } from '../lib/types.js';
import { useSession } from '../session.js';

/** The calendar application page. */
export function Calendar(): JSX.Element {
  const { data: session } = useSession();
  const [searchParams] = useSearchParams();

  const [state, setState] = useState<{
    dashboard: DashboardResponse | null;
    events: CalendarEventDto[];
    loading: boolean;
    error: ApiError | null;
  }>({ dashboard: null, events: [], loading: true, error: null });

  const load = useCallback(async () => {
    // Keeps any already-loaded dashboard visible while refetching — a role
    // switch re-runs this exact effect, and resetting to `null` would
    // unmount AppShell (sidebar included) on every switch.
    setState((current) => ({ ...current, loading: true, error: null }));
    try {
      const params = new URLSearchParams();
      const organizationId = searchParams.get('organizationId');
      const workspaceId = searchParams.get('workspaceId');
      if (organizationId !== null) params.set('organizationId', organizationId);
      if (workspaceId !== null) params.set('workspaceId', workspaceId);
      const suffix = params.size > 0 ? `?${params.toString()}` : '';
      const dashboard = await api<DashboardResponse>(`/dashboard${suffix}`);
      if (dashboard.organization === null || dashboard.workspace === null) {
        setState({ dashboard, events: [], loading: false, error: null });
        return;
      }
      const listed = await api<{ events: CalendarEventDto[] }>(
        `/calendar/events?organizationId=${encodeURIComponent(dashboard.organization.id)}&workspaceId=${encodeURIComponent(dashboard.workspace.id)}`,
      );
      setState({ dashboard, events: listed.events, loading: false, error: null });
    } catch (error) {
      setState((current) => ({
        ...current,
        loading: false,
        error:
          error instanceof ApiError ? error : new ApiError(0, 'INTERNAL_ERROR', 'Request failed'),
      }));
    }
  }, [searchParams]);

  useEffect(() => {
    void load();
  }, [load]);

  if (state.loading && state.dashboard === null) {
    return <LoadingScreen />;
  }
  if (state.error !== null) {
    return <ErrorState message={state.error.message} onRetry={() => void load()} />;
  }
  const { dashboard } = state;
  if (dashboard === null || session === null) {
    return <LoadingScreen />;
  }
  if (dashboard.organization === null || dashboard.workspace === null) {
    return (
      <div
        style={{
          height: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: 24,
        }}
      >
        <Card padding={10} elevationLevel="md" style={{ maxWidth: 520, width: '100%' }}>
          <EmptyState
            icon="📅"
            title="Create a workspace first"
            description="Calendar events live inside a workspace. Set one up to get started."
            action={
              <Button size="lg" onClick={() => void load()}>
                Reload
              </Button>
            }
          />
        </Card>
      </div>
    );
  }

  return (
    <AppShell
      user={dashboard.user}
      organizationName={dashboard.organization.name}
      workspaceName={dashboard.workspace.name}
      organizationId={dashboard.organization.id}
      workspaceId={dashboard.workspace.id}
    >
      <CalendarView
        organizationId={dashboard.organization.id}
        workspaceId={dashboard.workspace.id}
        organizationName={dashboard.organization.name}
        workspaceName={dashboard.workspace.name}
        initialEvents={state.events}
        onChanged={() => void load()}
      />
    </AppShell>
  );
}

/** One of the three supported calendar views. */
type CalendarViewMode = 'month' | 'week' | 'day';

/** Props of {@link CalendarView}. */
export interface CalendarViewProps {
  organizationId: string;
  workspaceId: string;
  organizationName: string;
  workspaceName: string;
  initialEvents: readonly CalendarEventDto[];
  onChanged: () => void;
}

const WEEKDAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const TITLE_MAX_LENGTH = 120;

/** The pure calendar content (exported for smoke tests). */
export function CalendarView({
  organizationId,
  workspaceId,
  organizationName,
  workspaceName,
  initialEvents,
  onChanged,
}: CalendarViewProps): JSX.Element {
  const [events, setEvents] = useState<CalendarEventDto[]>(() => [...initialEvents]);
  useEffect(() => {
    setEvents([...initialEvents]);
  }, [initialEvents]);

  const today = useMemo(() => startOfDay(new Date()), []);
  const [view, setView] = useState<CalendarViewMode>('month');
  const [referenceDate, setReferenceDate] = useState<Date>(today);
  const [selectedDate, setSelectedDate] = useState<Date>(today);
  const [creating, setCreating] = useState(false);

  const eventsByDay = useMemo(() => groupEventsByDay(events), [events]);
  const upcoming = useMemo(() => upcomingEvents(events, new Date(), 5), [events]);

  const goToday = useCallback(() => {
    setReferenceDate(today);
    setSelectedDate(today);
  }, [today]);

  const step = useCallback(
    (direction: 1 | -1) => {
      setReferenceDate((current) => shiftReference(current, view, direction));
    },
    [view],
  );

  const handleCreated = useCallback(
    (event: CalendarEventDto) => {
      setEvents((previous) => [event, ...previous]);
      setCreating(false);
      onChanged();
    },
    [onChanged],
  );

  const handleUpdated = useCallback(
    (event: CalendarEventDto) => {
      setEvents((previous) => previous.map((item) => (item.id === event.id ? event : item)));
      onChanged();
    },
    [onChanged],
  );

  const rangeLabel = formatRangeLabel(referenceDate, view);
  const selectedDayEvents = (eventsByDay.get(dayKey(selectedDate)) ?? [])
    .slice()
    .sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt));

  return (
    <Stack gap={6} style={{ maxWidth: 1200, margin: '0 auto' }}>
      <Stack
        direction="row"
        gap={4}
        align="center"
        justify="space-between"
        style={{ flexWrap: 'wrap' }}
      >
        <Stack gap={1}>
          <h1 className="nexora-page-title">Calendar</h1>
          <p style={{ fontSize: typography.sizes.sm, color: 'var(--nexora-textSecondary)' }}>
            {organizationName} · {workspaceName}
          </p>
        </Stack>
        <Button size="sm" onClick={() => setCreating((open) => !open)}>
          {creating ? 'Cancel' : '+ New event'}
        </Button>
      </Stack>

      {creating ? (
        <CreateEventForm
          organizationId={organizationId}
          workspaceId={workspaceId}
          defaultDay={selectedDate}
          onCreated={handleCreated}
          onCancel={() => setCreating(false)}
        />
      ) : null}

      <Card style={{ padding: '14px 16px' }}>
        <Stack
          direction="row"
          gap={3}
          align="center"
          justify="space-between"
          style={{ flexWrap: 'wrap' }}
        >
          <Stack direction="row" gap={2} align="center">
            <Button size="sm" variant="ghost" aria-label="Previous" onClick={() => step(-1)}>
              ‹
            </Button>
            <div
              style={{
                fontSize: typography.sizes.md,
                fontWeight: typography.weights.semibold,
                minWidth: 160,
                textAlign: 'center',
              }}
            >
              {rangeLabel}
            </div>
            <Button size="sm" variant="ghost" aria-label="Next" onClick={() => step(1)}>
              ›
            </Button>
            <Button size="sm" variant="secondary" onClick={goToday}>
              Today
            </Button>
          </Stack>
          <div
            className="nexora-calendar-view-switch"
            style={{
              display: 'inline-flex',
              border: '1px solid var(--nexora-borderStrong)',
              borderRadius: 8,
              overflow: 'hidden',
            }}
          >
            {(['month', 'week', 'day'] as const).map((mode) => (
              <button
                key={mode}
                type="button"
                aria-pressed={view === mode}
                aria-label={`${mode} view`}
                onClick={() => setView(mode)}
                style={{
                  border: 'none',
                  padding: '6px 14px',
                  fontSize: typography.sizes.sm,
                  fontWeight:
                    view === mode ? typography.weights.semibold : typography.weights.regular,
                  background: view === mode ? 'var(--nexora-primarySoft)' : 'transparent',
                  color: view === mode ? 'var(--nexora-primary)' : 'var(--nexora-textSecondary)',
                  cursor: 'pointer',
                  textTransform: 'capitalize',
                }}
              >
                {mode}
              </button>
            ))}
          </div>
        </Stack>
      </Card>

      <div className="nexora-calendar-layout">
        <div className="nexora-calendar-main">
          {view === 'month' ? (
            <MonthGrid
              referenceDate={referenceDate}
              today={today}
              selectedDate={selectedDate}
              eventsByDay={eventsByDay}
              onSelectDay={setSelectedDate}
            />
          ) : view === 'week' ? (
            <WeekGrid
              referenceDate={referenceDate}
              today={today}
              selectedDate={selectedDate}
              eventsByDay={eventsByDay}
              onSelectDay={setSelectedDate}
            />
          ) : (
            <DayAgenda
              day={referenceDate}
              today={today}
              organizationId={organizationId}
              workspaceId={workspaceId}
              events={eventsByDay.get(dayKey(referenceDate)) ?? []}
              onUpdated={handleUpdated}
            />
          )}
        </div>

        <div className="nexora-calendar-side">
          {view !== 'day' ? (
            <Card>
              <Stack gap={3}>
                <div style={{ fontWeight: typography.weights.semibold }}>
                  {formatDayHeading(selectedDate, today)}
                </div>
                {selectedDayEvents.length === 0 ? (
                  <EmptyState
                    icon="📅"
                    title="No events"
                    description="Nothing scheduled for this day."
                  />
                ) : (
                  <Stack gap={2}>
                    {selectedDayEvents.map((event) => (
                      <EventRow
                        key={event.id}
                        event={event}
                        organizationId={organizationId}
                        workspaceId={workspaceId}
                        compact
                        onUpdated={handleUpdated}
                      />
                    ))}
                  </Stack>
                )}
              </Stack>
            </Card>
          ) : null}

          <Card>
            <Stack gap={3}>
              <div style={{ fontWeight: typography.weights.semibold }}>Upcoming</div>
              {upcoming.length === 0 ? (
                <p style={{ fontSize: typography.sizes.sm, color: 'var(--nexora-textMuted)' }}>
                  No upcoming events.
                </p>
              ) : (
                <Stack gap={2}>
                  {upcoming.map((event) => (
                    <button
                      key={event.id}
                      type="button"
                      onClick={() => {
                        const day = startOfDay(new Date(event.startsAt));
                        setReferenceDate(day);
                        setSelectedDate(day);
                      }}
                      style={{
                        display: 'block',
                        width: '100%',
                        textAlign: 'left',
                        border: 'none',
                        background: 'transparent',
                        cursor: 'pointer',
                        padding: 0,
                      }}
                    >
                      <Stack gap={0.5}>
                        <div
                          style={{
                            fontSize: typography.sizes.sm,
                            fontWeight: typography.weights.medium,
                          }}
                        >
                          {event.title}
                        </div>
                        <div
                          style={{
                            fontSize: typography.sizes.xs,
                            color: 'var(--nexora-textMuted)',
                          }}
                        >
                          {formatUpcomingWhen(event.startsAt)}
                        </div>
                      </Stack>
                    </button>
                  ))}
                </Stack>
              )}
            </Stack>
          </Card>
        </div>
      </div>

      <style>{`
        .nexora-calendar-layout {
          display: grid;
          grid-template-columns: minmax(0, 1fr) 300px;
          gap: 20px;
          align-items: start;
        }
        .nexora-calendar-side {
          display: flex;
          flex-direction: column;
          gap: 16px;
        }
        @media (max-width: 1024px) {
          .nexora-calendar-layout { grid-template-columns: minmax(0, 1fr) 260px; }
        }
        @media (max-width: 768px) {
          .nexora-calendar-layout { grid-template-columns: minmax(0, 1fr); }
          .nexora-calendar-view-switch button { padding: 6px 10px; }
        }
      `}</style>
    </Stack>
  );
}

/** The month grid — compact on narrow viewports (numbers + dots, no titles). */
function MonthGrid({
  referenceDate,
  today,
  selectedDate,
  eventsByDay,
  onSelectDay,
}: {
  referenceDate: Date;
  today: Date;
  selectedDate: Date;
  eventsByDay: Map<string, CalendarEventDto[]>;
  onSelectDay: (day: Date) => void;
}): JSX.Element {
  const days = useMemo(() => monthGridDays(referenceDate), [referenceDate]);
  const currentMonth = referenceDate.getMonth();

  return (
    <Card padding={4} style={{ overflow: 'hidden' }}>
      <div
        className="nexora-month-header"
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(7, minmax(0, 1fr))',
          marginBottom: 8,
        }}
      >
        {WEEKDAY_LABELS.map((label) => (
          <div
            key={label}
            style={{
              fontSize: typography.sizes.xs,
              fontWeight: typography.weights.medium,
              color: 'var(--nexora-textMuted)',
              textAlign: 'center',
              padding: '4px 0',
            }}
          >
            {label}
          </div>
        ))}
      </div>
      <div
        className="nexora-month-grid"
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(7, minmax(0, 1fr))',
          gap: 4,
        }}
      >
        {days.map((day) => {
          const key = dayKey(day);
          const dayEvents = (eventsByDay.get(key) ?? []).sort(
            (a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt),
          );
          const isToday = key === dayKey(today);
          const isSelected = key === dayKey(selectedDate);
          const inMonth = day.getMonth() === currentMonth;
          const visible = dayEvents.slice(0, 2);
          const overflow = dayEvents.length - visible.length;
          return (
            <button
              key={key}
              type="button"
              onClick={() => onSelectDay(day)}
              className="nexora-month-cell"
              style={{
                textAlign: 'left',
                border: isSelected
                  ? '1px solid var(--nexora-primary)'
                  : '1px solid var(--nexora-border)',
                background: isSelected ? 'var(--nexora-primarySoft)' : 'var(--nexora-surface)',
                borderRadius: 8,
                padding: 6,
                minHeight: 84,
                cursor: 'pointer',
                display: 'flex',
                flexDirection: 'column',
                gap: 4,
                opacity: inMonth ? 1 : 0.45,
              }}
            >
              <span
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  width: 22,
                  height: 22,
                  borderRadius: '50%',
                  fontSize: typography.sizes.xs,
                  fontWeight: isToday ? typography.weights.bold : typography.weights.medium,
                  background: isToday ? 'var(--nexora-primary)' : 'transparent',
                  color: isToday ? 'var(--nexora-primaryForeground)' : 'var(--nexora-text)',
                }}
              >
                {day.getDate()}
              </span>
              <span className="nexora-month-cell-dots" style={{ display: 'none', gap: 3 }}>
                {dayEvents.slice(0, 4).map((event) => (
                  <span
                    key={event.id}
                    aria-hidden
                    style={{
                      width: 5,
                      height: 5,
                      borderRadius: '50%',
                      background:
                        event.status === 'cancelled'
                          ? 'var(--nexora-textMuted)'
                          : 'var(--nexora-primary)',
                    }}
                  />
                ))}
              </span>
              <span
                className="nexora-month-cell-chips"
                style={{ display: 'flex', flexDirection: 'column', gap: 2 }}
              >
                {visible.map((event) => (
                  <span
                    key={event.id}
                    style={{
                      fontSize: '0.6875rem',
                      lineHeight: 1.3,
                      padding: '1px 5px',
                      borderRadius: 4,
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      textDecoration: event.status === 'cancelled' ? 'line-through' : 'none',
                      color:
                        event.status === 'cancelled'
                          ? 'var(--nexora-textMuted)'
                          : 'var(--nexora-primary)',
                      background:
                        event.status === 'cancelled' ? 'transparent' : 'var(--nexora-primarySoft)',
                    }}
                  >
                    {event.title}
                  </span>
                ))}
                {overflow > 0 ? (
                  <span style={{ fontSize: '0.6875rem', color: 'var(--nexora-textMuted)' }}>
                    +{overflow} more
                  </span>
                ) : null}
              </span>
            </button>
          );
        })}
      </div>
      <style>{`
        @media (max-width: 768px) {
          .nexora-month-cell { min-height: 52px !important; padding: 4px !important; }
          .nexora-month-cell-chips { display: none !important; }
          .nexora-month-cell-dots { display: flex !important; }
        }
      `}</style>
    </Card>
  );
}

/** The week grid — one agenda column per day. */
function WeekGrid({
  referenceDate,
  today,
  selectedDate,
  eventsByDay,
  onSelectDay,
}: {
  referenceDate: Date;
  today: Date;
  selectedDate: Date;
  eventsByDay: Map<string, CalendarEventDto[]>;
  onSelectDay: (day: Date) => void;
}): JSX.Element {
  const days = useMemo(() => weekDays(referenceDate), [referenceDate]);
  return (
    <div
      className="nexora-week-grid"
      style={{ display: 'grid', gridTemplateColumns: 'repeat(7, minmax(0, 1fr))', gap: 8 }}
    >
      {days.map((day) => {
        const key = dayKey(day);
        const dayEvents = (eventsByDay.get(key) ?? []).sort(
          (a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt),
        );
        const isToday = key === dayKey(today);
        const isSelected = key === dayKey(selectedDate);
        return (
          <Card
            key={key}
            padding={2.5}
            interactive
            style={{
              cursor: 'pointer',
              border: isSelected
                ? '1px solid var(--nexora-primary)'
                : '1px solid var(--nexora-border)',
              minHeight: 200,
            }}
          >
            <button
              type="button"
              onClick={() => onSelectDay(day)}
              style={{
                width: '100%',
                border: 'none',
                background: 'transparent',
                cursor: 'pointer',
                textAlign: 'left',
                padding: 0,
              }}
            >
              <Stack gap={2}>
                <Stack gap={0.5}>
                  <div style={{ fontSize: typography.sizes.xs, color: 'var(--nexora-textMuted)' }}>
                    {WEEKDAY_LABELS[day.getDay()]}
                  </div>
                  <div
                    style={{
                      fontSize: typography.sizes.md,
                      fontWeight: typography.weights.semibold,
                      color: isToday ? 'var(--nexora-primary)' : 'var(--nexora-text)',
                    }}
                  >
                    {day.getDate()}
                  </div>
                </Stack>
                <Stack gap={1.5}>
                  {dayEvents.length === 0 ? (
                    <span
                      style={{ fontSize: typography.sizes.xs, color: 'var(--nexora-textMuted)' }}
                    >
                      —
                    </span>
                  ) : (
                    dayEvents.map((event) => (
                      <span
                        key={event.id}
                        style={{
                          fontSize: '0.6875rem',
                          lineHeight: 1.3,
                          padding: '2px 6px',
                          borderRadius: 4,
                          textDecoration: event.status === 'cancelled' ? 'line-through' : 'none',
                          color:
                            event.status === 'cancelled'
                              ? 'var(--nexora-textMuted)'
                              : 'var(--nexora-primary)',
                          background:
                            event.status === 'cancelled'
                              ? 'transparent'
                              : 'var(--nexora-primarySoft)',
                        }}
                      >
                        {formatTime(event.startsAt)} · {event.title}
                      </span>
                    ))
                  )}
                </Stack>
              </Stack>
            </button>
          </Card>
        );
      })}
    </div>
  );
}

/** The single-day agenda — the full detail view (used directly by the day view). */
function DayAgenda({
  day,
  today,
  organizationId,
  workspaceId,
  events,
  onUpdated,
}: {
  day: Date;
  today: Date;
  organizationId: string;
  workspaceId: string;
  events: CalendarEventDto[];
  onUpdated: (event: CalendarEventDto) => void;
}): JSX.Element {
  const sorted = events.slice().sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt));
  return (
    <Card>
      <Stack gap={4}>
        <div style={{ fontWeight: typography.weights.semibold }}>
          {formatDayHeading(day, today)}
        </div>
        {sorted.length === 0 ? (
          <EmptyState icon="📅" title="No events" description="Nothing scheduled for this day." />
        ) : (
          <Stack gap={3}>
            {sorted.map((event) => (
              <EventRow
                key={event.id}
                event={event}
                organizationId={organizationId}
                workspaceId={workspaceId}
                onUpdated={onUpdated}
              />
            ))}
          </Stack>
        )}
      </Stack>
    </Card>
  );
}

/** Formats a two-line "today, upcoming" summary line for an upcoming-events entry. */
function formatUpcomingWhen(iso: string): string {
  const date = new Date(iso);
  const datePart = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  const timePart = date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  return `${datePart} · ${timePart}`;
}

/** Formats a heading like "Today" / "Tomorrow" / "Mon, Sep 1". */
function formatDayHeading(day: Date, today: Date): string {
  if (dayKey(day) === dayKey(today)) return 'Today';
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);
  if (dayKey(day) === dayKey(tomorrow)) return 'Tomorrow';
  return day.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}

/** Formats the header range label for the active view. */
function formatRangeLabel(referenceDate: Date, view: CalendarViewMode): string {
  if (view === 'month') {
    return referenceDate.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  }
  if (view === 'day') {
    return referenceDate.toLocaleDateString('en-US', {
      weekday: 'long',
      month: 'long',
      day: 'numeric',
    });
  }
  const days = weekDays(referenceDate);
  const first = days[0];
  const last = days[6];
  if (first === undefined || last === undefined) return '';
  // Always include the month on both ends — omitting it from just one side
  // (e.g. `{ day, year }` with no `month`) hits an ICU formatting quirk in
  // some engines that renders as literal "(day: N)" text instead of a date.
  const firstLabel = first.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  const lastLabel = last.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
  return `${firstLabel} – ${lastLabel}`;
}

/** Formats a time like "3:00 PM". */
function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

/** Formats a duration like "1h" or "45m" or "1h 30m". */
function formatDuration(startsAt: string, endsAt: string): string {
  const minutes = Math.round((Date.parse(endsAt) - Date.parse(startsAt)) / 60_000);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return remainder === 0 ? `${hours}h` : `${hours}h ${remainder}m`;
}

/** The zero-time start of the given day (local time). */
function startOfDay(date: Date): Date {
  const copy = new Date(date);
  copy.setHours(0, 0, 0, 0);
  return copy;
}

/** A stable local-date key (`yyyy-mm-dd`) for bucketing/lookups. */
function dayKey(date: Date): string {
  const pad = (value: number): string => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** Groups events by their local calendar day (bucketed by `startsAt`). */
function groupEventsByDay(events: readonly CalendarEventDto[]): Map<string, CalendarEventDto[]> {
  const map = new Map<string, CalendarEventDto[]>();
  for (const event of events) {
    const key = dayKey(new Date(event.startsAt));
    const bucket = map.get(key);
    if (bucket === undefined) {
      map.set(key, [event]);
    } else {
      bucket.push(event);
    }
  }
  return map;
}

/** The next N scheduled events at or after `from`, soonest first. */
function upcomingEvents(
  events: readonly CalendarEventDto[],
  from: Date,
  limit: number,
): CalendarEventDto[] {
  return events
    .filter((event) => event.status === 'scheduled' && Date.parse(event.endsAt) >= from.getTime())
    .sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt))
    .slice(0, limit);
}

/** The 6×7 grid of days covering the month of `referenceDate` (Sunday-start). */
function monthGridDays(referenceDate: Date): Date[] {
  const firstOfMonth = new Date(referenceDate.getFullYear(), referenceDate.getMonth(), 1);
  const start = new Date(firstOfMonth);
  start.setDate(start.getDate() - start.getDay());
  const days: Date[] = [];
  for (let i = 0; i < 42; i += 1) {
    const day = new Date(start);
    day.setDate(start.getDate() + i);
    days.push(day);
  }
  return days;
}

/** The 7 days (Sunday-start) of the week containing `referenceDate`. */
function weekDays(referenceDate: Date): Date[] {
  const start = new Date(referenceDate);
  start.setDate(start.getDate() - start.getDay());
  const days: Date[] = [];
  for (let i = 0; i < 7; i += 1) {
    const day = new Date(start);
    day.setDate(start.getDate() + i);
    days.push(day);
  }
  return days;
}

/** Shifts `referenceDate` by one unit of the active view. */
function shiftReference(referenceDate: Date, view: CalendarViewMode, direction: 1 | -1): Date {
  const next = new Date(referenceDate);
  if (view === 'month') {
    next.setMonth(next.getMonth() + direction);
  } else if (view === 'week') {
    next.setDate(next.getDate() + direction * 7);
  } else {
    next.setDate(next.getDate() + direction);
  }
  return next;
}

/** Converts an ISO instant to a `datetime-local` input value (local time). */
function toDatetimeLocalValue(iso: string): string {
  const date = new Date(iso);
  const pad = (value: number): string => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** Converts a `datetime-local` input value (local time) to an ISO instant, or `undefined` if invalid. */
function fromDatetimeLocalValue(value: string): string | undefined {
  if (value.trim().length === 0) return undefined;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return undefined;
  return parsed.toISOString();
}

/** Validates a title/start/end triple against the SAME rules the backend enforces. */
function validateEventInput(
  title: string,
  startValue: string,
  endValue: string,
): { field: string; message: string }[] {
  const issues: { field: string; message: string }[] = [];
  const trimmedTitle = title.trim();
  if (trimmedTitle.length === 0) {
    issues.push({ field: 'title', message: 'A title is required' });
  } else if (trimmedTitle.length > TITLE_MAX_LENGTH) {
    issues.push({ field: 'title', message: `Must be at most ${TITLE_MAX_LENGTH} characters` });
  }
  const startsAt = fromDatetimeLocalValue(startValue);
  const endsAt = fromDatetimeLocalValue(endValue);
  if (startsAt === undefined) {
    issues.push({ field: 'startsAt', message: 'A valid start time is required' });
  }
  if (endsAt === undefined) {
    issues.push({ field: 'endsAt', message: 'A valid end time is required' });
  }
  if (
    startsAt !== undefined &&
    endsAt !== undefined &&
    Date.parse(endsAt) <= Date.parse(startsAt)
  ) {
    issues.push({ field: 'endsAt', message: 'End time must be after the start time' });
  }
  return issues;
}

/** The inline create-event form. */
function CreateEventForm({
  organizationId,
  workspaceId,
  defaultDay,
  onCreated,
  onCancel,
}: {
  organizationId: string;
  workspaceId: string;
  defaultDay: Date;
  onCreated: (event: CalendarEventDto) => void;
  onCancel: () => void;
}): JSX.Element {
  const defaults = useMemo(() => {
    const start = new Date(defaultDay);
    start.setHours(9, 0, 0, 0);
    const end = new Date(defaultDay);
    end.setHours(10, 0, 0, 0);
    return {
      start: toDatetimeLocalValue(start.toISOString()),
      end: toDatetimeLocalValue(end.toISOString()),
    };
  }, [defaultDay]);

  const [title, setTitle] = useState('');
  const [startValue, setStartValue] = useState(defaults.start);
  const [endValue, setEndValue] = useState(defaults.end);
  const [issues, setIssues] = useState<{ field: string; message: string }[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const issueFor = (field: string): string | undefined =>
    issues.find((issue) => issue.field === field)?.message;

  const handleSubmit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    const validation = validateEventInput(title, startValue, endValue);
    setIssues(validation);
    if (validation.length > 0) {
      return;
    }
    const startsAt = fromDatetimeLocalValue(startValue);
    const endsAt = fromDatetimeLocalValue(endValue);
    if (startsAt === undefined || endsAt === undefined) {
      return;
    }
    setSubmitting(true);
    setSubmitError(null);
    try {
      const created = await api<{ event: CalendarEventDto }>('/calendar/events', {
        method: 'POST',
        body: JSON.stringify({
          organizationId,
          workspaceId,
          title: title.trim(),
          startsAt,
          endsAt,
        }),
      });
      onCreated(created.event);
    } catch (error) {
      setSubmitError(error instanceof ApiError ? error.message : 'Could not create the event.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Card>
      <form onSubmit={(event) => void handleSubmit(event)}>
        <Stack gap={4} stretch>
          <Stack gap={1}>
            <div style={{ fontWeight: typography.weights.semibold }}>New event</div>
            <div style={{ fontSize: typography.sizes.xs, color: 'var(--nexora-textMuted)' }}>
              The AI can also schedule events — “Schedule a project review on Monday at 3pm.”
            </div>
          </Stack>
          <Field label="Title" required error={issueFor('title')}>
            <Input
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="Project Review"
              invalid={issueFor('title') !== undefined}
              maxLength={TITLE_MAX_LENGTH}
            />
          </Field>
          <Stack direction="row" gap={3} stretch style={{ flexWrap: 'wrap' }}>
            <div style={{ flex: '1 1 200px' }}>
              <Field label="Starts" required error={issueFor('startsAt')}>
                <Input
                  type="datetime-local"
                  value={startValue}
                  onChange={(event) => setStartValue(event.target.value)}
                  invalid={issueFor('startsAt') !== undefined}
                />
              </Field>
            </div>
            <div style={{ flex: '1 1 200px' }}>
              <Field label="Ends" required error={issueFor('endsAt')}>
                <Input
                  type="datetime-local"
                  value={endValue}
                  onChange={(event) => setEndValue(event.target.value)}
                  invalid={issueFor('endsAt') !== undefined}
                />
              </Field>
            </div>
          </Stack>
          {submitError !== null ? (
            <p style={{ fontSize: typography.sizes.sm, color: 'var(--nexora-danger)' }}>
              {submitError}
            </p>
          ) : null}
          <Stack direction="row" gap={3}>
            <Button type="submit" size="sm" loading={submitting} disabled={submitting}>
              {submitting ? 'Creating…' : 'Create event'}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={onCancel}
              disabled={submitting}
            >
              Discard
            </Button>
          </Stack>
        </Stack>
      </form>
    </Card>
  );
}

/** A single event row with status, duration, and (when scheduled) edit/cancel actions. */
export function EventRow({
  event,
  organizationId,
  workspaceId,
  compact = false,
  onUpdated,
}: {
  event: CalendarEventDto;
  organizationId: string;
  workspaceId: string;
  compact?: boolean;
  onUpdated: (event: CalendarEventDto) => void;
}): JSX.Element {
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(event.title);
  const [startValue, setStartValue] = useState(() => toDatetimeLocalValue(event.startsAt));
  const [endValue, setEndValue] = useState(() => toDatetimeLocalValue(event.endsAt));
  const [issues, setIssues] = useState<{ field: string; message: string }[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmingCancel, setConfirmingCancel] = useState(false);

  const isCancelled = event.status === 'cancelled';
  const isPast = Date.parse(event.endsAt) < Date.now();

  const beginEdit = (): void => {
    setTitle(event.title);
    setStartValue(toDatetimeLocalValue(event.startsAt));
    setEndValue(toDatetimeLocalValue(event.endsAt));
    setIssues([]);
    setError(null);
    setEditing(true);
  };

  const handleSave = async (): Promise<void> => {
    const validation = validateEventInput(title, startValue, endValue);
    setIssues(validation);
    if (validation.length > 0) {
      return;
    }
    const startsAt = fromDatetimeLocalValue(startValue);
    const endsAt = fromDatetimeLocalValue(endValue);
    if (startsAt === undefined || endsAt === undefined) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const updated = await api<{ event: CalendarEventDto }>(`/calendar/events/${event.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          organizationId,
          workspaceId,
          title: title.trim(),
          startsAt,
          endsAt,
        }),
      });
      setEditing(false);
      onUpdated(updated.event);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Could not save the event.');
    } finally {
      setBusy(false);
    }
  };

  const handleCancelEvent = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      const cancelled = await api<{ event: CalendarEventDto }>(
        `/calendar/events/${event.id}/cancel`,
        { method: 'POST', body: JSON.stringify({ organizationId, workspaceId }) },
      );
      setConfirmingCancel(false);
      onUpdated(cancelled.event);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Could not cancel the event.');
    } finally {
      setBusy(false);
    }
  };

  const issueFor = (field: string): string | undefined =>
    issues.find((issue) => issue.field === field)?.message;

  if (editing) {
    return (
      <Card style={{ padding: compact ? '10px 12px' : '14px 16px' }}>
        <Stack gap={3}>
          <Field label="Title" required error={issueFor('title')}>
            <Input
              value={title}
              onChange={(evt) => setTitle(evt.target.value)}
              invalid={issueFor('title') !== undefined}
              maxLength={TITLE_MAX_LENGTH}
            />
          </Field>
          <Stack direction="row" gap={3} stretch style={{ flexWrap: 'wrap' }}>
            <div style={{ flex: '1 1 160px' }}>
              <Field label="Starts" required error={issueFor('startsAt')}>
                <Input
                  type="datetime-local"
                  value={startValue}
                  onChange={(evt) => setStartValue(evt.target.value)}
                  invalid={issueFor('startsAt') !== undefined}
                />
              </Field>
            </div>
            <div style={{ flex: '1 1 160px' }}>
              <Field label="Ends" required error={issueFor('endsAt')}>
                <Input
                  type="datetime-local"
                  value={endValue}
                  onChange={(evt) => setEndValue(evt.target.value)}
                  invalid={issueFor('endsAt') !== undefined}
                />
              </Field>
            </div>
          </Stack>
          {error !== null ? (
            <div style={{ fontSize: typography.sizes.xs, color: 'var(--nexora-danger)' }}>
              {error}
            </div>
          ) : null}
          <Stack direction="row" gap={3}>
            <Button size="sm" onClick={() => void handleSave()} disabled={busy} loading={busy}>
              {busy ? 'Saving…' : 'Save'}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setEditing(false)} disabled={busy}>
              Cancel
            </Button>
          </Stack>
        </Stack>
      </Card>
    );
  }

  return (
    <Card
      style={{
        padding: compact ? '10px 12px' : '14px 16px',
        opacity: isCancelled || isPast ? 0.7 : 1,
      }}
    >
      <Stack
        direction="row"
        gap={3}
        align="center"
        justify="space-between"
        style={{ flexWrap: 'wrap' }}
      >
        <Stack gap={0.5} style={{ minWidth: 0 }}>
          <div
            style={{
              fontWeight: typography.weights.semibold,
              textDecoration: isCancelled ? 'line-through' : 'none',
              color: isCancelled ? 'var(--nexora-textMuted)' : 'var(--nexora-text)',
            }}
          >
            {event.title}
          </div>
          <Stack direction="row" gap={2} align="center" style={{ flexWrap: 'wrap' }}>
            <EventStatusBadge status={event.status} />
            <span style={{ fontSize: typography.sizes.xs, color: 'var(--nexora-textMuted)' }}>
              {formatTime(event.startsAt)} – {formatTime(event.endsAt)} ·{' '}
              {formatDuration(event.startsAt, event.endsAt)}
            </span>
          </Stack>
          {error !== null ? (
            <div style={{ fontSize: typography.sizes.xs, color: 'var(--nexora-danger)' }}>
              {error}
            </div>
          ) : null}
        </Stack>
        {!isCancelled ? (
          <Stack direction="row" gap={2} align="center" style={{ flexShrink: 0 }}>
            {confirmingCancel ? (
              <>
                <Button
                  size="sm"
                  variant="danger"
                  onClick={() => void handleCancelEvent()}
                  disabled={busy}
                  loading={busy}
                >
                  Confirm cancel
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setConfirmingCancel(false)}
                  disabled={busy}
                >
                  Keep
                </Button>
              </>
            ) : (
              <>
                <Button size="sm" variant="ghost" onClick={beginEdit}>
                  Edit
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setConfirmingCancel(true)}>
                  Cancel event
                </Button>
              </>
            )}
          </Stack>
        ) : null}
      </Stack>
    </Card>
  );
}

/** Maps a calendar-entry status to a badge (only two lifecycle values exist). */
export function EventStatusBadge({ status }: { status: string }): JSX.Element {
  if (status === 'cancelled') {
    return <Badge tone="danger">Cancelled</Badge>;
  }
  if (status === 'scheduled') {
    return (
      <Badge tone="success" dot>
        Scheduled
      </Badge>
    );
  }
  return <Skeleton height={18} width={70} />;
}
