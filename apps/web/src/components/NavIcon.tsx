/**
 * @nexora/app-web — NavIcon.
 *
 * A tiny monochrome line-icon set for the sidebar + command palette. 16px,
 * 1.5 stroke, `currentColor` — inherits the nav item's text color so the
 * whole rail reads as one system (no emoji, no color drift). Lucide-derived
 * geometry, hand-trimmed to the handful of names the nav catalog uses.
 */

import type { CSSProperties } from 'react';

/** The icon names the nav catalog + command palette reference. */
export type IconName =
  | 'command-center'
  | 'agent'
  | 'problems'
  | 'projects'
  | 'employees'
  | 'documents'
  | 'knowledge'
  | 'workflows'
  | 'calendar'
  | 'finance'
  | 'audit'
  | 'apps'
  | 'integrations'
  | 'insights'
  | 'assistant'
  | 'search'
  | 'settings'
  | 'bell'
  | 'bell-off'
  | 'chevron-down'
  | 'arrow-right'
  | 'check'
  | 'sparkles';

const PATHS: Record<IconName, JSX.Element> = {
  'command-center': (
    <>
      <path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M19.1 4.9L17 7M7 17l-2.1 2.1" />
      <circle cx="12" cy="12" r="3.2" />
    </>
  ),
  agent: (
    <>
      <path d="M20 6 9 17l-5-5" />
    </>
  ),
  problems: (
    <>
      <path d="M10.3 3.6 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.6a2 2 0 0 0-3.4 0Z" />
      <path d="M12 9v4M12 17h.01" />
    </>
  ),
  projects: (
    <>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M3 9h18M8 20V9" />
    </>
  ),
  employees: (
    <>
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" />
    </>
  ),
  documents: (
    <>
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <path d="M14 2v6h6M9 13h6M9 17h6" />
    </>
  ),
  knowledge: (
    <>
      <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
      <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2Z" />
    </>
  ),
  workflows: (
    <>
      <rect x="3" y="3" width="7" height="7" rx="1.5" />
      <rect x="14" y="14" width="7" height="7" rx="1.5" />
      <path d="M10 6.5h4a3 3 0 0 1 3 3V14" />
    </>
  ),
  calendar: (
    <>
      <rect x="3" y="4" width="18" height="18" rx="2" />
      <path d="M8 2v4M16 2v4M3 10h18" />
    </>
  ),
  finance: (
    <>
      <path d="M12 1v22M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
    </>
  ),
  audit: (
    <>
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z" />
      <path d="m9 12 2 2 4-4" />
    </>
  ),
  apps: (
    <>
      <rect x="3" y="3" width="7" height="7" rx="1.5" />
      <rect x="14" y="3" width="7" height="7" rx="1.5" />
      <rect x="14" y="14" width="7" height="7" rx="1.5" />
      <rect x="3" y="14" width="7" height="7" rx="1.5" />
    </>
  ),
  integrations: (
    <>
      <path d="M6 3v6M18 3v6M6 15v6M18 15v6" />
      <rect x="3" y="9" width="6" height="6" rx="1.5" />
      <rect x="15" y="9" width="6" height="6" rx="1.5" />
      <path d="M9 12h6" />
    </>
  ),
  insights: (
    <>
      <path d="M3 3v18h18" />
      <path d="m7 15 3-4 4 3 5-7" />
    </>
  ),
  assistant: (
    <>
      <path d="M21 15a2 2 0 0 1-2 2H8l-4 4V5a2 2 0 0 1 2-2h13a2 2 0 0 1 2 2Z" />
    </>
  ),
  search: (
    <>
      <circle cx="11" cy="11" r="7" />
      <path d="m21 21-4.3-4.3" />
    </>
  ),
  settings: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.6 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9c.14.36.44.63.82.77" />
    </>
  ),
  bell: (
    <>
      <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
      <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
    </>
  ),
  'bell-off': (
    <>
      <path d="M8.7 3A6 6 0 0 1 18 8c0 2.4.36 4.2.9 5.5M17 17H3s3-2 3-9M10.3 21a1.94 1.94 0 0 0 3.4 0M2 2l20 20" />
    </>
  ),
  'chevron-down': <path d="m6 9 6 6 6-6" />,
  'arrow-right': (
    <>
      <path d="M5 12h14M13 5l7 7-7 7" />
    </>
  ),
  check: <path d="M20 6 9 17l-5-5" />,
  sparkles: (
    <>
      <path d="M9.9 15.5A2 2 0 0 0 8.5 14.1l-6.1-1.6a.5.5 0 0 1 0-1L8.5 9.9A2 2 0 0 0 9.9 8.5l1.6-6.1a.5.5 0 0 1 1 0l1.6 6.1a2 2 0 0 0 1.4 1.4l6.1 1.6a.5.5 0 0 1 0 1l-6.1 1.6a2 2 0 0 0-1.4 1.4l-1.6 6.1a.5.5 0 0 1-1 0Z" />
      <path d="M20 3v4M22 5h-4M4 17v2M5 18H3" />
    </>
  ),
};

/** Props of {@link NavIcon}. */
export interface NavIconProps {
  /** The icon name (a key of the nav catalog's line-icon set). */
  name: IconName;
  /** Square size in px (default 16). */
  size?: number;
  /** Extra style. */
  style?: CSSProperties;
}

/** Renders one 16px monochrome line icon. */
export function NavIcon({ name, size = 16, style }: NavIconProps): JSX.Element {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      style={{ flexShrink: 0, display: 'block', ...style }}
    >
      {PATHS[name]}
    </svg>
  );
}
