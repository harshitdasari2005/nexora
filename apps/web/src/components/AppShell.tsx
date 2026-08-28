/**
 * @nexora/app-web — AppShell.
 *
 * The persistent nine-region application frame (FRONTEND.md §4): sidebar
 * navigation, top bar, and the content area. The shell is the OS — it stays
 * constant across every app view. The top bar hosts the Notification
 * Center (Notification + Activity Feed vertical slice).
 *
 * S44: the shell runs the light enterprise theme (`:root` default tokens,
 * no `data-theme` override) — warm-white page, white cards, a hair of
 * surface differentiation for the sidebar/topbar, role color used only for
 * badges/active-nav/icons rather than as an ambient wash. The S39–S41
 * cinematic 3D ambient background (`DigitalHeadquarters`/
 * `IntelligenceNetwork`) was retired from the authenticated shell entirely
 * — it stays on Login only, which keeps its own separate composition.
 *
 * S33: the shell's accent, navigation priority, and role badge are driven
 * by the caller's RESOLVED business role (`RoleThemeContext`) rather than
 * the current page path — switching roles changes the workspace; switching
 * pages within one role does not. Nav re-fades and the role badge pulses
 * briefly whenever the resolved role actually changes, so a role switch
 * reads as Nexora recalculating context, not a reload — deliberately
 * subtle now (S44), not the earlier full-screen accent sweep.
 */

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Avatar, Badge, spacing, typography } from '@nexora/design-system';

import { isModuleVisible } from '../lib/modules.js';
import {
  applyNavLabelOverride,
  resolvePersonaForRole,
  type RolePersona,
} from '../lib/rolePersonas.js';
import { RoleThemeProvider, useRoleTheme } from '../lib/RoleThemeContext.js';
import type { RoleTheme } from '../lib/roleThemes.js';
import type { UserDto } from '../lib/types.js';
import { CommandPalette } from './CommandPalette.js';
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

// Every icon here is unique within the list — a first-time user scanning the
// sidebar has to be able to tell items apart by glyph alone, before ever
// reading the label. (This used to not be true: Command Center, Agent, and
// AI Assistant all shared '✦', and Projects/Documents both used '▤' — three
// and two destinations respectively were visually indistinguishable at a
// glance. Fixed as part of the first-time-user audit.) 'Overview' (`/app`)
// is gone entirely: it duplicated Command Center's own greeting while
// showing far less, so `Dashboard` now sends an onboarded user straight to
// Command Center instead of stopping at a second, thinner "home."
const BASE_NAV_ITEMS: readonly NavItem[] = [
  { label: 'Command Center', icon: '✦', to: '/app/command-center' },
  { label: 'Agent', icon: '✓', to: '/app/agent' },
  { label: 'Problems', icon: '⚠', to: '/app/problems' },
  { label: 'Projects', icon: '▤', to: '/app/projects' },
  { label: 'Employees', icon: '👥', to: '/app/employees' },
  { label: 'Documents', icon: '📄', to: '/app/documents' },
  { label: 'Knowledge', icon: '📚', to: '/app/knowledge' },
  { label: 'Workflows', icon: '⧉', to: '/app/workflows' },
  { label: 'Calendar', icon: '📅', to: '/app/calendar' },
  { label: 'Finance', icon: '💰', to: '/app/finance' },
  { label: 'Audit', icon: '🛡', to: '/app/audit' },
  { label: 'Apps', icon: '▦', to: '/app/apps' },
  { label: 'Integrations', icon: '🔌', to: '/app/integrations' },
  { label: 'Insights', icon: '📊', to: '/app/insights' },
  { label: 'AI Assistant', icon: '💬', to: '/app/assistant' },
  { label: 'Search', icon: '⌕', action: 'search' },
  { label: 'Settings', icon: '⚙', to: '/app/settings' },
];

/** The nav catalog split into primary (leading) and secondary (deprioritized) tiers. */
interface TieredNav {
  primary: readonly NavItem[];
  secondary: readonly NavItem[];
}

/**
 * Reorders the fixed nav catalog so the active role's priorities lead, THEN
 * filters to the modules the caller's RBAC permission set actually unlocks
 * (S34) — real filtering, not CSS: a role without `problems.read` never
 * sees "Problems" rendered at all, matching what the backend would actually
 * allow (`authorizePermission` fails closed the same way). Presentation
 * only — the backend remains authoritative regardless of what renders here.
 *
 * S35: when the resolved role maps to one of the six curated personas, nav
 * visibility is ADDITIONALLY curated by that persona's primary/secondary
 * module lists (declutter only — a persona can hide a module the caller is
 * permitted to see, never show one it isn't). Roles outside the six
 * personas (e.g. Sales, Product) are untouched: one flat RBAC-filtered list,
 * exactly the pre-S35 behavior.
 */
function orderNavItems(
  theme: RoleTheme,
  permissions: readonly string[],
  persona: RolePersona | undefined,
): TieredNav {
  const byLabel = new Map(BASE_NAV_ITEMS.map((item) => [item.label, item] as const));
  const ordered: NavItem[] = [];
  for (const label of theme.navPriority) {
    const item = byLabel.get(label);
    if (item !== undefined) {
      ordered.push(item);
      byLabel.delete(label);
    }
  }
  // Any catalog item a role's `navPriority` doesn't mention (e.g. Apps,
  // Integrations, Search, Settings for most roles) still needs to render —
  // appended last rather than dropped.
  for (const item of BASE_NAV_ITEMS) {
    if (byLabel.has(item.label)) ordered.push(item);
  }
  const visible = ordered.filter((item) => isModuleVisible(item.label, permissions));
  if (persona === undefined) {
    return { primary: visible, secondary: [] };
  }
  const byLabelVisible = new Map(visible.map((item) => [item.label, item] as const));
  const primary = persona.primaryModules
    .map((label) => byLabelVisible.get(label))
    .filter((item): item is NavItem => item !== undefined);
  const secondary = persona.secondaryModules
    .map((label) => byLabelVisible.get(label))
    .filter((item): item is NavItem => item !== undefined);
  return { primary, secondary };
}

/** Renders one nav item — shared by the primary and secondary tiers. */
function renderNavItem(
  item: NavItem,
  options: {
    pathname: string;
    scopeSuffix: string;
    theme: RoleTheme;
    persona: RolePersona | undefined;
    onSearch: () => void;
    muted?: boolean;
  },
): JSX.Element {
  const { pathname, scopeSuffix, theme, persona, onSearch, muted = false } = options;
  const active =
    item.to !== undefined &&
    (item.to === '/app' ? pathname === '/app' : pathname.startsWith(item.to));
  const label = applyNavLabelOverride(persona, item.label);
  const content = (
    <>
      <span aria-hidden style={{ width: 18, textAlign: 'center' }}>
        {item.icon}
      </span>
      <span>{label}</span>
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
    padding: muted ? '7px 10px' : '9px 10px',
    borderRadius: 8,
    fontSize: muted ? typography.sizes.sm : typography.sizes.base,
    color: active
      ? 'var(--nexora-text)'
      : muted
        ? 'var(--nexora-textMuted)'
        : 'var(--nexora-textSecondary)',
    background: active ? theme.accentSoft : 'transparent',
    borderLeft: active ? `2px solid ${theme.accent}` : '2px solid transparent',
    fontWeight: active ? typography.weights.medium : typography.weights.regular,
    cursor: item.soon ? 'default' : 'pointer',
    opacity: item.soon ? 0.7 : muted ? 0.82 : 1,
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
        onClick={onSearch}
        style={{ ...style, background: 'transparent', borderLeft: '2px solid transparent' }}
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
}

// Module-level, not component state: every top-level authenticated page
// wraps its OWN `<AppShell>` instance, so the shell technically remounts
// on each in-app navigation even though it reads as one persistent OS
// chrome. This flag survives those remounts (reset only by a real page
// load) so the "entering the operating environment" entrance plays
// exactly once per authenticated session — right after the OAuth
// callback lands on `/app` — never replayed on ordinary navigation
// between Command Center, Problems, Agent, etc. (S39).
let hasEnteredEnvironment = false;

/** Renders the persistent application shell. */
export function AppShell(props: AppShellProps): JSX.Element {
  return (
    <RoleThemeProvider organizationId={props.organizationId} workspaceId={props.workspaceId}>
      <AppShellChrome {...props} />
    </RoleThemeProvider>
  );
}

/** The actual shell chrome — reads the resolved role theme via context. */
function AppShellChrome({
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
  const { theme, current } = useRoleTheme();
  // "Entering the Nexora operating environment": a brief, one-time entrance
  // right after authentication — never replayed on later in-app navigation.
  const [grandEntrance] = useState(() => {
    const first = !hasEnteredEnvironment;
    hasEnteredEnvironment = true;
    return first;
  });

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

  // The signature role-transition signal: replays whenever the RESOLVED
  // role actually changes (never on first paint, never on a plain page
  // navigation within the same role). A CSS keyframe animation keyed by an
  // incrementing counter — no manual timers, and it collapses to nothing
  // under `prefers-reduced-motion` via the same global rule that flattens
  // every animation-duration to 0.01ms.
  const previousRoleIdRef = useRef<string | undefined>(undefined);
  const [sweepGeneration, setSweepGeneration] = useState(0);
  useEffect(() => {
    const roleId = current?.roleId;
    if (roleId === undefined) return;
    if (previousRoleIdRef.current !== undefined && previousRoleIdRef.current !== roleId) {
      setSweepGeneration((value) => value + 1);
    }
    previousRoleIdRef.current = roleId;
  }, [current?.roleId]);

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

  const persona = resolvePersonaForRole(current?.roleId);
  const { primary: primaryNavItems, secondary: secondaryNavItems } = orderNavItems(
    theme,
    current?.permissions ?? [],
    persona,
  );
  const roleLabel =
    persona !== undefined
      ? `${persona.displayRole} · ${persona.focusLabel}`
      : current !== null
        ? `${current.domainName} · ${current.roleName}`
        : theme.identity;

  return (
    <div
      className={`nexora-shell${grandEntrance ? ' nexora-shell-enter' : ''}`}
      style={{
        height: '100vh',
        display: 'flex',
        overflow: 'hidden',
        position: 'relative',
        background: 'var(--nexora-bg)',
        color: 'var(--nexora-text)',
      }}
    >
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

        {/* Navigation — remounts (and fades in) on a resolved-role change,
            the "sidebar module visibility" half of the role-transition
            signal (S35). Secondary-tier modules render in a visually
            quieter group below a "More" divider rather than blending in at
            equal weight with the role's primary work. */}
        <nav
          key={current?.roleId ?? 'default'}
          aria-label="Workspace navigation"
          className="nexora-nav-fade"
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 2,
            padding: `0 ${spacing[3]}`,
            overflowY: 'auto',
          }}
        >
          {primaryNavItems.map((item) =>
            renderNavItem(item, {
              pathname,
              scopeSuffix,
              theme,
              persona,
              onSearch: () => setSearchOpen(true),
            }),
          )}
          {secondaryNavItems.length > 0 ? (
            <>
              <div
                aria-hidden
                style={{
                  padding: '12px 10px 4px',
                  fontSize: typography.sizes.xs,
                  fontWeight: typography.weights.medium,
                  color: 'var(--nexora-textMuted)',
                  textTransform: 'uppercase',
                  letterSpacing: '0.05em',
                }}
              >
                More
              </div>
              {secondaryNavItems.map((item) =>
                renderNavItem(item, {
                  pathname,
                  scopeSuffix,
                  theme,
                  persona,
                  onSearch: () => setSearchOpen(true),
                  muted: true,
                }),
              )}
            </>
          ) : null}
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
            <span
              key={sweepGeneration}
              className="nexora-role-badge-pulse"
              style={{ display: 'inline-flex' }}
            >
              <Badge
                dot
                dotColor={theme.accent}
                style={{
                  background: theme.accentSoft,
                  color: theme.accent,
                  border: `1px solid ${theme.accent}55`,
                }}
              >
                {roleLabel}
              </Badge>
            </span>
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
        @keyframes nexora-shell-enter {
          from { opacity: 0; transform: scale(0.985); filter: blur(6px); }
          to { opacity: 1; transform: scale(1); filter: blur(0); }
        }
        .nexora-shell-enter {
          animation: nexora-shell-enter 480ms cubic-bezier(0.16, 1, 0.3, 1) both;
        }
        @keyframes nexora-role-badge-pulse {
          0% { transform: scale(1); }
          30% { transform: scale(1.08); }
          100% { transform: scale(1); }
        }
        .nexora-role-badge-pulse {
          animation: nexora-role-badge-pulse 550ms cubic-bezier(0.16, 1, 0.3, 1);
        }
        @keyframes nexora-nav-fade {
          0% { opacity: 0; transform: translateY(4px); }
          100% { opacity: 1; transform: translateY(0); }
        }
        .nexora-nav-fade {
          animation: nexora-nav-fade 420ms cubic-bezier(0.16, 1, 0.3, 1);
        }
        @media (prefers-reduced-motion: reduce) {
          .nexora-nav-fade { animation: none; }
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
