/**
 * @nexora/app-web — page building blocks.
 *
 * The few pieces every app page is assembled from, so a page reads the same
 * way wherever you are: a title that says what the page is for, sections with
 * plain headings, a route of stations for anything that moves between people,
 * and one loud thing — the amber marker — for "this is waiting for you".
 */

import type { ReactNode } from 'react';
import { typography } from '@nexora/design-system';

/** The page container: fluid, centered, capped at a readable width. */
export function Page({
  children,
  wide = false,
  standalone = false,
}: {
  children: ReactNode;
  /** A wider cap, for pages that are mostly tables or boards. */
  wide?: boolean;
  /** No app shell around it — the page brings its own gutters. */
  standalone?: boolean;
}): JSX.Element {
  const classes = [
    'nexora-page',
    wide ? 'nexora-page-wide' : '',
    standalone ? 'nexora-page-standalone' : '',
  ]
    .filter(Boolean)
    .join(' ');
  return (
    <div className={classes} style={{ display: 'flex', flexDirection: 'column', gap: 28 }}>
      {children}
    </div>
  );
}

/** The page title, one sentence on what it is for, and the page's main action. */
export function PageHeader({
  title,
  lede,
  actions,
}: {
  title: string;
  lede?: ReactNode;
  actions?: ReactNode;
}): JSX.Element {
  return (
    <header className="nexora-page-head">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <h1 className="nexora-page-title">{title}</h1>
        {lede === undefined ? null : <p className="nexora-page-lede">{lede}</p>}
      </div>
      {actions === undefined ? null : <div className="nexora-actions">{actions}</div>}
    </header>
  );
}

/** A section: a plain heading (with an optional count) above its content. */
export function Section({
  title,
  count,
  hint,
  children,
}: {
  title: string;
  count?: number;
  hint?: string;
  children: ReactNode;
}): JSX.Element {
  return (
    <section style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
        <h2 className="nexora-section-title">{title}</h2>
        {count === undefined ? null : (
          <span style={{ fontSize: typography.sizes.sm, color: 'var(--nexora-textMuted)' }}>
            {count}
          </span>
        )}
        {hint === undefined ? null : (
          <span style={{ fontSize: typography.sizes.sm, color: 'var(--nexora-textMuted)' }}>
            {hint}
          </span>
        )}
      </div>
      {children}
    </section>
  );
}

/** A small heading inside a card (history, checklist, …). */
export function SubHeading({ children }: { children: ReactNode }): JSX.Element {
  return (
    <div
      style={{
        fontSize: typography.sizes.sm,
        fontWeight: typography.weights.semibold,
        color: 'var(--nexora-text)',
      }}
    >
      {children}
    </div>
  );
}

/** The amber marker: this item is waiting for the person looking at it. */
export function TurnTag({ children = 'Your turn' }: { children?: ReactNode }): JSX.Element {
  return <span className="nexora-turn-tag">{children}</span>;
}

/** One labelled fact. */
export function Fact({ label, children }: { label: string; children: ReactNode }): JSX.Element {
  return (
    <div style={{ minWidth: 0 }}>
      <div style={{ fontSize: typography.sizes.xs, color: 'var(--nexora-textMuted)' }}>{label}</div>
      <div style={{ fontSize: typography.sizes.base, overflowWrap: 'anywhere' }}>{children}</div>
    </div>
  );
}

/** Where a station on a route stands. */
export type RouteStopState = 'done' | 'current' | 'waiting' | 'skipped' | 'returned';

/** One station of a {@link Route}. */
export interface RouteStop {
  label: string;
  state: RouteStopState;
  /** Overrides the default note for the state (e.g. who it is waiting on). */
  note?: string;
}

const ROUTE_NOTE: Record<RouteStopState, string> = {
  done: 'Done',
  current: 'In progress',
  waiting: 'Not yet',
  skipped: 'Not needed',
  returned: 'Returned',
};

/**
 * The stations a piece of work passes through, in order — a line with a dot
 * per station. It lies flat on a wide screen and stands upright on a phone.
 */
export function Route({
  stops,
  testId,
}: {
  stops: readonly RouteStop[];
  testId?: string;
}): JSX.Element {
  return (
    <ol
      className="nexora-route"
      data-testid={testId}
      style={{ listStyle: 'none', margin: 0, padding: 0 }}
    >
      {stops.map((stop) => (
        <li
          key={stop.label}
          className="nexora-route-stop"
          data-state={stop.state}
          data-reached={stop.state === 'done' || stop.state === 'skipped'}
        >
          <span className="nexora-route-dot" aria-hidden />
          <div
            style={{
              fontSize: typography.sizes.sm,
              fontWeight:
                stop.state === 'waiting' ? typography.weights.medium : typography.weights.semibold,
              color:
                stop.state === 'waiting' ? 'var(--nexora-textSecondary)' : 'var(--nexora-text)',
              paddingRight: 8,
            }}
          >
            {stop.label}
          </div>
          <div
            style={{
              fontSize: typography.sizes.xs,
              color: stop.state === 'returned' ? 'var(--nexora-danger)' : 'var(--nexora-textMuted)',
              paddingRight: 8,
            }}
          >
            {stop.note ?? ROUTE_NOTE[stop.state]}
          </div>
        </li>
      ))}
    </ol>
  );
}
