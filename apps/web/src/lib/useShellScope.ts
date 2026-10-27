/**
 * @nexora/app-web — the scope a page runs in.
 *
 * Reads `/api/dashboard` for the (organization, workspace) named in the URL —
 * the server answers with the caller's real membership, so the scope a page
 * then uses is one the backend has confirmed, never one the browser made up.
 */

import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';

import { api, ApiError } from './api.js';
import type { DashboardResponse } from './types.js';

/** The state of a page's scope lookup. */
export interface ShellScopeState {
  dashboard: DashboardResponse | null;
  loading: boolean;
  error: ApiError | null;
  reload: () => void;
}

/** Loads the dashboard (user, organization, workspace) for the URL's scope. */
export function useShellScope(): ShellScopeState {
  const [searchParams] = useSearchParams();
  const organizationId = searchParams.get('organizationId');
  const workspaceId = searchParams.get('workspaceId');
  const [state, setState] = useState<Omit<ShellScopeState, 'reload'>>({
    dashboard: null,
    loading: true,
    error: null,
  });

  const load = useCallback(() => {
    const params = new URLSearchParams();
    if (organizationId !== null) params.set('organizationId', organizationId);
    if (workspaceId !== null) params.set('workspaceId', workspaceId);
    const suffix = params.size > 0 ? `?${params.toString()}` : '';
    setState((current) => ({ ...current, loading: true, error: null }));
    api<DashboardResponse>(`/dashboard${suffix}`).then(
      (dashboard) => setState({ dashboard, loading: false, error: null }),
      (error: unknown) =>
        setState((current) => ({
          ...current,
          loading: false,
          error:
            error instanceof ApiError ? error : new ApiError(0, 'INTERNAL_ERROR', 'Request failed'),
        })),
    );
  }, [organizationId, workspaceId]);

  useEffect(load, [load]);
  return { ...state, reload: load };
}
