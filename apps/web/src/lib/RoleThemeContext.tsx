/**
 * @nexora/app-web — role theme context (S33).
 *
 * Resolves the caller's trusted role ONCE per (organization, workspace)
 * scope — via the SAME `/api/role-context` endpoint the RoleSwitcher already
 * calls — and exposes the matching {@link RoleTheme} to every descendant
 * (AppShell's chrome, the Command Center, Agent, Problems) through context,
 * so they render the same lens without each re-fetching independently.
 */

import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';

import { api } from './api.js';
import { DEFAULT_THEME, themeForRole, type RoleTheme } from './roleThemes.js';
import type { RoleContextOption } from './types.js';

/** The resolved role + its theme, exposed to the authenticated app tree. */
export interface RoleThemeValue {
  /** The active role's theme (falls back to {@link DEFAULT_THEME} while loading). */
  theme: RoleTheme;
  /** The full resolved role-context option, once loaded. */
  current: RoleContextOption | null;
  /** True until the first role-context response arrives. */
  loading: boolean;
}

const RoleThemeContext = createContext<RoleThemeValue>({
  theme: DEFAULT_THEME,
  current: null,
  loading: true,
});

/** Props of {@link RoleThemeProvider}. */
export interface RoleThemeProviderProps {
  organizationId?: string;
  workspaceId?: string;
  children: ReactNode;
}

/** Resolves and provides the active role's theme for the given scope. */
export function RoleThemeProvider({
  organizationId,
  workspaceId,
  children,
}: RoleThemeProviderProps): JSX.Element {
  const [value, setValue] = useState<RoleThemeValue>({
    theme: DEFAULT_THEME,
    current: null,
    loading: true,
  });

  useEffect(() => {
    let cancelled = false;
    setValue((prev) => ({ ...prev, loading: true }));
    const params = new URLSearchParams();
    if (organizationId !== undefined) params.set('organizationId', organizationId);
    if (workspaceId !== undefined) params.set('workspaceId', workspaceId);
    const suffix = params.size > 0 ? `?${params.toString()}` : '';
    api<{ current: RoleContextOption | null }>(`/role-context${suffix}`)
      .then((result) => {
        if (cancelled) return;
        setValue({
          theme: themeForRole(result.current?.roleId),
          current: result.current,
          loading: false,
        });
      })
      .catch(() => {
        if (cancelled) return;
        setValue({ theme: DEFAULT_THEME, current: null, loading: false });
      });
    return () => {
      cancelled = true;
    };
  }, [organizationId, workspaceId]);

  return <RoleThemeContext.Provider value={value}>{children}</RoleThemeContext.Provider>;
}

/** Reads the active role's theme (safe default outside a provider). */
export function useRoleTheme(): RoleThemeValue {
  return useContext(RoleThemeContext);
}
