/**
 * @nexora/app-web — AppShell.
 *
 * The persistent nine-region application frame (FRONTEND.md §4): sidebar
 * navigation, top bar, and the content area. The shell is the OS — it stays
 * constant across every app view. The top bar hosts the Notification
 * Center (Notification + Activity Feed vertical slice).
 *
 * S32: the shell runs the dark navy theme (the same intelligence
 * environment as Landing/Login, quieted to `ambient`) so every authenticated
 * page inherits the premium look instead of silently falling back to light.
 */

import { useEffect, useState, type ReactNode } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Avatar, Badge, spacing, typography } from '@nexora/design-system';

import type { UserDto } from '../lib/types.js';
import { CommandPalette } from './CommandPalette.js';
import { IntelligenceNetwork, type IntelligenceNetworkTint } from './IntelligenceNetwork.js';
import { NotificationCenter } from './NotificationCenter.js';
import { RoleSwitcher } from './RoleSwitcher.js';

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
  /** A non-navigation action (e.g. opening the search palette). */
  action?: 'search';
}

const NAV_ITEMS: readonly NavItem[] = [
  { label: 'Overview', icon: '◎', to: '/app' },
  { label: 'Command Center', icon: '✦', to: '/app/command-center' },
  { label: 'Agent', icon: '✦', to: '/app/agent' },
  { label: 'Problems', icon: '⚠', to: '/app/problems' },
  { label: 'Projects', icon: '▤', to: '/app/projects' },
  { label: 'Employees', icon: '⚕', to: '/app/employees' },
  { label: 'Documents', icon: '▤', to: '/app/documents' },
  { label: 'Knowledge', icon: '📚', to: '/app/knowledge' },
  { label: 'Workflows', icon: '⧉', to: '/app/workflows' },
  { label: 'Apps', icon: '▦', to: '/app/apps' },
  { label: 'Integrations', icon: '🔌', to: '/app/integrations' },
  { label: 'Insights', icon: '📊', to: '/app/insights' },
  { label: 'AI Assistant', icon: '✦', to: '/app/assistant' },
  { label: 'Search', icon: '⌕', action: 'search' },
  { label: 'Settings', icon: '⚙', to: '/app/settings' },
];

/** The extremely-subtle per-page atmosphere hue (never a different theme). */
function pageTintFor(pathname: string): IntelligenceNetworkTint {
  if (pathname.startsWith('/app/problems')) return 'amber';
  if (pathname.startsWith('/app/agent') || pathname.startsWith('/app/assistant')) return 'violet';
  if (pathname.startsWith('/app/insights')) return 'teal';
  if (
    pathname.startsWith('/app/settings') ||
    pathname.startsWith('/app/projects') ||
    pathname.startsWith('/app/workflows') ||
    pathname.startsWith('/app/apps') ||
    pathname.startsWith('/app/integrations') ||
    pathname.startsWith('/app/documents') ||
    pathname.startsWith('/app/knowledge') ||
    pathname.startsWith('/app/employees')
  ) {
    return 'slate';
  }
  return 'indigo';
}

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
  const [searchOpen, setSearchOpen] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  // Global ⌘K / Ctrl+K opens the search palette from anywhere in the shell.
  // Escape closes the mobile drawer when it's open.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setSearchOpen(true);
      } else if (event.key === 'Escape') {
        setMobileNavOpen(false);
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, []);

  // A route change means navigation happened — the drawer's job is done.
  useEffect(() => {
    setMobileNavOpen(false);
  }, [pathname]);

  // Carries the current trusted (organization, workspace) scope across
  // in-app navigation — otherwise every nav link would reset to the
  // server's default scope and undo a role switch the moment the user
  // moves to another page (S27 Phase 6).
  const scopeSuffix = (() => {
    const params = new URLSearchParams();
    if (organizationId !== undefined) params.set('organizationId', organizationId);
    if (workspaceId !== undefined) params.set('workspaceId', workspaceId);
    const suffix = params.toString();
    return suffix.length > 0 ? `?${suffix}` : '';
  })();

  const tint = pageTintFor(pathname);

  return (
    <div
      data-theme="dark"
      className="nexora-shell"
      style={{
        height: '100vh',
        display: 'flex',
        overflow: 'hidden',
        position: 'relative',
        background: 'var(--nexora-bg)',
        color: 'var(--nexora-text)',
      }}
    >
      {/* Global ambient background — the same intelligence environment as
          Landing/Login, quieted for sustained work. Sits behind every
          region; sidebar/topbar stay solid so it never fights legibility. */}
      <div
        aria-hidden="true"
        style={{ position: 'absolute', inset: 0, zIndex: 0, pointerEvents: 'none' }}
      >
        <IntelligenceNetwork quiet ambient tint={tint} />
      </div>

      {/* Sidebar */}
      <aside
        className={`nexora-sidebar${mobileNavOpen ? ' nexora-sidebar-open' : ''}`}
        style={{
          width: 248,
          flexShrink: 0,
          position: 'relative',
          zIndex: 1,
          background: 'var(--nexora-shellSidebar, var(--nexora-surface))',
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
          <button
            type="button"
            aria-label="Close navigation"
            className="nexora-drawer-close"
            onClick={() => setMobileNavOpen(false)}
            style={{
              marginLeft: 'auto',
              display: 'none',
              background: 'transparent',
              border: 'none',
              color: 'var(--nexora-textMuted)',
              fontSize: typography.sizes.lg,
              cursor: 'pointer',
              padding: spacing[1],
            }}
          >
            ✕
          </button>
        </div>

        {/* Workspace context / role switcher */}
        <div
          style={{
            margin: `0 ${spacing[3]} ${spacing[4]}`,
            padding: spacing[4],
            background: 'var(--nexora-surfaceMuted)',
            border: '1px solid var(--nexora-border)',
            borderRadius: 12,
          }}
        >
          <RoleSwitcher
            organizationId={organizationId}
            workspaceId={workspaceId}
            organizationName={organizationName}
            workspaceName={workspaceName}
          />
        </div>

        {/* Navigation */}
        <nav
          aria-label="Workspace navigation"
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 2,
            padding: `0 ${spacing[3]}`,
            overflowY: 'auto',
          }}
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
                {item.action === 'search' ? (
                  <span
                    style={{
                      marginLeft: 'auto',
                      fontSize: typography.sizes.xs,
                      color: 'var(--nexora-textMuted)',
                    }}
                  >
                    ⌘K
                  </span>
                ) : item.soon === true ? (
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
              padding: '9px 10px',
              borderRadius: 8,
              fontSize: typography.sizes.base,
              color: active ? 'var(--nexora-text)' : 'var(--nexora-textSecondary)',
              background: active ? 'var(--nexora-primarySoft)' : 'transparent',
              borderLeft: active ? '2px solid var(--nexora-primary)' : '2px solid transparent',
              boxShadow: active ? '0 0 20px -6px rgba(99, 102, 241, 0.45)' : 'none',
              fontWeight: active ? typography.weights.medium : typography.weights.regular,
              cursor: item.soon ? 'default' : 'pointer',
              opacity: item.soon ? 0.7 : 1,
              textDecoration: 'none',
              border: 'none',
              width: '100%',
              textAlign: 'left',
              fontFamily: 'inherit',
              transition: 'background 140ms ease, color 140ms ease',
            } as const;
            const className = `nexora-navlink${active ? ' nexora-navlink-active' : ''}`;
            if (item.action === 'search') {
              return (
                <button
                  key={item.label}
                  type="button"
                  className={className}
                  onClick={() => setSearchOpen(true)}
                  style={{
                    ...style,
                    background: 'transparent',
                    borderLeft: '2px solid transparent',
                  }}
                >
                  {content}
                </button>
              );
            }
            return item.to !== undefined ? (
              <Link
                key={item.label}
                to={`${item.to}${scopeSuffix}`}
                aria-current={active ? 'page' : undefined}
                className={className}
                style={style}
              >
                {content}
              </Link>
            ) : (
              <div key={item.label} className={className} style={style}>
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

      {/* Mobile drawer backdrop — blocks background interaction while the
          drawer is open, closes it on click. */}
      {mobileNavOpen ? (
        <div
          aria-hidden="true"
          className="nexora-drawer-backdrop"
          onClick={() => setMobileNavOpen(false)}
        />
      ) : null}

      {/* Main column */}
      <div
        style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          minWidth: 0,
          position: 'relative',
          zIndex: 1,
        }}
      >
        {/* Top bar */}
        <header
          style={{
            height: 56,
            flexShrink: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            paddingInline: spacing[6],
            gap: spacing[3],
            borderBottom: '1px solid var(--nexora-border)',
            background: 'var(--nexora-shellTopbar, var(--nexora-surface))',
            backdropFilter: 'blur(14px)',
            WebkitBackdropFilter: 'blur(14px)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
            <button
              type="button"
              aria-label="Open navigation"
              aria-expanded={mobileNavOpen}
              className="nexora-hamburger"
              onClick={() => setMobileNavOpen(true)}
              style={{
                display: 'none',
                background: 'transparent',
                border: '1px solid var(--nexora-border)',
                borderRadius: 8,
                color: 'var(--nexora-text)',
                width: 32,
                height: 32,
                fontSize: typography.sizes.md,
                cursor: 'pointer',
                flexShrink: 0,
              }}
            >
              ☰
            </button>
            <span
              className="nexora-crumb-org"
              style={{
                fontSize: typography.sizes.sm,
                color: 'var(--nexora-textMuted)',
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}
            >
              {organizationName}
            </span>
            <span className="nexora-crumb-org" style={{ color: 'var(--nexora-textMuted)' }}>
              /
            </span>
            <span
              style={{
                fontSize: typography.sizes.sm,
                fontWeight: typography.weights.medium,
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}
            >
              {workspaceName}
            </span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0 }}>
            <Badge tone="ai" dot>
              AI platform
            </Badge>
            <NotificationCenter organizationId={organizationId} workspaceId={workspaceId} />
          </div>
        </header>

        {/* Content */}
        <main
          className="nexora-main"
          style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden', padding: spacing[8] }}
        >
          {children}
        </main>
      </div>

      {/* Optional right column (AI panel) */}
      {right !== undefined ? (
        <aside
          className="nexora-right-panel"
          style={{ width: 380, flexShrink: 0, minWidth: 0, position: 'relative', zIndex: 1 }}
        >
          {right}
        </aside>
      ) : null}

      <CommandPalette
        open={searchOpen}
        onClose={() => setSearchOpen(false)}
        organizationId={organizationId}
        workspaceId={workspaceId}
      />

      <style>{`
        .nexora-navlink:hover:not(.nexora-navlink-active) {
          background: rgba(148, 163, 184, 0.08);
          color: var(--nexora-text);
        }
        .nexora-drawer-backdrop {
          position: fixed;
          inset: 0;
          background: var(--nexora-overlay);
          z-index: 39;
        }
        @media (max-width: 900px) {
          .nexora-crumb-org { display: none; }
          .nexora-hamburger { display: inline-flex !important; align-items: center; justify-content: center; }
          .nexora-drawer-close { display: inline-flex !important; align-items: center; justify-content: center; }
          /* Off-canvas drawer instead of the old display:none — a real
             mobile navigation mechanism, not a squeezed desktop sidebar. */
          .nexora-sidebar {
            /* !important: inline styles set position:relative/z-index:1 for
               the desktop layout — only !important can override them from
               an embedded stylesheet rule at this breakpoint. */
            position: fixed !important;
            inset: 0 auto 0 0;
            height: 100vh;
            z-index: 40 !important;
            box-shadow: 8px 0 32px rgba(2, 4, 10, 0.5);
            transform: translateX(-100%);
            transition: transform 220ms cubic-bezier(0.2, 0, 0, 1);
          }
          .nexora-sidebar-open { transform: translateX(0); }
        }
        @media (prefers-reduced-motion: reduce) {
          .nexora-sidebar { transition: none; }
        }
        @media (max-width: 1100px) {
          /* Targets the optional right AI panel specifically — never
             last-of-type, which would also match the sidebar aside on
             pages with no right panel, hiding all navigation. */
          .nexora-right-panel { display: none !important; }
        }
        @media (max-width: 640px) {
          .nexora-main { padding: ${spacing[4]} !important; }
        }
      `}</style>
    </div>
  );
}
