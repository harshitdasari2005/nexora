/**
 * @nexora/app-web — AppShell.
 *
 * The persistent nine-region application frame (FRONTEND.md §4): sidebar
 * navigation, top bar, and the content area. The shell is the OS — it stays
 * constant across every app view. The top bar hosts the Notification
 * Center (Notification + Activity Feed vertical slice).
 */

import type { ReactNode } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Avatar, Badge, spacing, typography } from '@nexora/design-system';

import type { UserDto } from '../lib/types.js';
import { NotificationCenter } from './NotificationCenter.js';

/** Props of {@link AppShell}. */
export interface AppShellProps {
  /** The current user (sidebar identity chip). */
  user: UserDto;
  /** The current organization name. */
  organizationName: string;
  /** The current workspace name. */
  workspaceName: string;
  /** The current organization id (Notification Center tenant scope). */
  organizationId?: string;
  /** The current workspace id (Notification Center workspace scope). */
  workspaceId?: string;
  /** The page content. */
  children: ReactNode;
  /** An optional full-height right column (e.g. the AI panel). */
  right?: ReactNode;
}

interface NavItem {
  label: string;
  icon: string;
  /** The destination route (renders a router link). */
  to?: string;
  /** Whether the destination is planned but not yet shipped. */
  soon?: boolean;
}

const NAV_ITEMS: readonly NavItem[] = [
  { label: 'Overview', icon: '◎', to: '/app' },
  { label: 'Projects', icon: '▤', to: '/app/projects' },
  { label: 'Employees', icon: '⚕', to: '/app/employees' },
  { label: 'Documents', icon: '▤', to: '/app/documents' },
  { label: 'Knowledge', icon: '📚', to: '/app/knowledge' },
  { label: 'Workflows', icon: '⧉', to: '/app/workflows' },
  { label: 'Apps', icon: '▦', to: '/app/apps' },
  { label: 'Integrations', icon: '🔌', to: '/app/integrations' },
  { label: 'AI Assistant', icon: '✦', soon: true },
  { label: 'Search', icon: '⌕', soon: true },
  { label: 'Settings', icon: '⚙', soon: true },
];

/** Renders the persistent application shell. */
export function AppShell({
  user,
  organizationName,
  workspaceName,
  organizationId,
  workspaceId,
  children,
  right,
}: AppShellProps): JSX.Element {
  const { pathname } = useLocation();
  return (
    <div style={{ height: '100vh', display: 'flex', overflow: 'hidden' }} className="nexora-shell">
      {/* Sidebar */}
      <aside
        className="nexora-sidebar"
        style={{
          width: 248,
          flexShrink: 0,
          background: 'var(--nexora-surface)',
          borderRight: '1px solid var(--nexora-border)',
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        {/* Wordmark */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: spacing[5] }}>
          <span
            aria-hidden
            style={{
              width: 26,
              height: 26,
              borderRadius: 8,
              background: 'linear-gradient(135deg, #6366f1, #7c3aed)',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 14,
            }}
          >
            ✦
          </span>
          <span style={{ fontWeight: typography.weights.bold, fontSize: typography.sizes.md }}>
            Nexora
          </span>
        </div>

        {/* Workspace context */}
        <div
          style={{
            margin: `0 ${spacing[3]} ${spacing[4]}`,
            padding: spacing[4],
            background: 'var(--nexora-surfaceMuted)',
            borderRadius: 12,
          }}
        >
          <div style={{ fontSize: typography.sizes.xs, color: 'var(--nexora-textMuted)' }}>
            {organizationName}
          </div>
          <div style={{ fontWeight: typography.weights.semibold, marginTop: 2 }}>
            {workspaceName}
          </div>
        </div>

        {/* Navigation */}
        <nav
          aria-label="Workspace navigation"
          style={{ display: 'flex', flexDirection: 'column', gap: 2, padding: `0 ${spacing[3]}` }}
        >
          {NAV_ITEMS.map((item) => {
            const active =
              item.to !== undefined &&
              (item.to === '/app' ? pathname === '/app' : pathname.startsWith(item.to));
            const content = (
              <>
                <span aria-hidden style={{ width: 18, textAlign: 'center' }}>
                  {item.icon}
                </span>
                <span>{item.label}</span>
                {item.soon === true ? (
                  <span
                    style={{
                      marginLeft: 'auto',
                      fontSize: typography.sizes.xs,
                      color: 'var(--nexora-textMuted)',
                    }}
                  >
                    soon
                  </span>
                ) : null}
              </>
            );
            const style = {
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              padding: `9px 10px`,
              borderRadius: 8,
              fontSize: typography.sizes.base,
              color: active ? 'var(--nexora-text)' : 'var(--nexora-textSecondary)',
              background: active ? 'var(--nexora-primarySoft)' : 'transparent',
              fontWeight: active ? typography.weights.medium : typography.weights.regular,
              cursor: item.soon ? 'default' : 'pointer',
              opacity: item.soon ? 0.7 : 1,
              textDecoration: 'none',
            } as const;
            return item.to !== undefined ? (
              <Link
                key={item.label}
                to={item.to}
                aria-current={active ? 'page' : undefined}
                style={style}
              >
                {content}
              </Link>
            ) : (
              <div key={item.label} style={style}>
                {content}
              </div>
            );
          })}
        </nav>

        {/* Identity chip */}
        <div
          style={{
            marginTop: 'auto',
            padding: spacing[4],
            borderTop: '1px solid var(--nexora-border)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <Avatar name={user.displayName} size={30} />
            <div style={{ minWidth: 0 }}>
              <div
                style={{
                  fontSize: typography.sizes.sm,
                  fontWeight: typography.weights.medium,
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                }}
              >
                {user.displayName}
              </div>
              <div
                style={{
                  fontSize: typography.sizes.xs,
                  color: 'var(--nexora-textMuted)',
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                }}
              >
                {user.email}
              </div>
            </div>
          </div>
          <a
            href="/api/auth/logout"
            style={{
              display: 'block',
              marginTop: spacing[3],
              fontSize: typography.sizes.xs,
              color: 'var(--nexora-textMuted)',
            }}
          >
            Sign out
          </a>
        </div>
      </aside>

      {/* Main column */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        {/* Top bar */}
        <header
          style={{
            height: 56,
            flexShrink: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            paddingInline: spacing[6],
            borderBottom: '1px solid var(--nexora-border)',
            background: 'var(--nexora-surface)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: typography.sizes.sm, color: 'var(--nexora-textMuted)' }}>
              {organizationName}
            </span>
            <span style={{ color: 'var(--nexora-textMuted)' }}>/</span>
            <span style={{ fontSize: typography.sizes.sm, fontWeight: typography.weights.medium }}>
              {workspaceName}
            </span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <Badge tone="ai" dot>
              AI platform
            </Badge>
            <Badge>v0.1 · onboarding</Badge>
            <NotificationCenter organizationId={organizationId} workspaceId={workspaceId} />
          </div>
        </header>

        {/* Content */}
        <main style={{ flex: 1, overflowY: 'auto', padding: spacing[8] }}>{children}</main>
      </div>

      {/* Optional right column (AI panel) */}
      {right !== undefined ? (
        <aside style={{ width: 380, flexShrink: 0, minWidth: 0 }}>{right}</aside>
      ) : null}

      <style>{`
        @media (max-width: 900px) {
          .nexora-sidebar { display: none; }
        }
        @media (max-width: 1100px) {
          .nexora-shell aside:last-of-type { display: none; }
        }
      `}</style>
    </div>
  );
}
