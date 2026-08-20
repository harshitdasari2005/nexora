/**
 * @nexora/app-web — Assistant page (S27 Phase 6).
 *
 * The dedicated AI Assistant surface: the SAME `AiPanel` already embedded as
 * the Dashboard's right-hand sidebar, given the full page instead of a 380px
 * column. No second chat architecture — this page only changes how much
 * room the EXISTING panel gets. Consequential actions still surface an
 * approval card and go through the EXISTING approval engine (never a
 * bypass); the panel is scoped to the caller's current trusted workspace,
 * same as everywhere else.
 */

import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Button, Card, EmptyState, typography } from '@nexora/design-system';

import { AppShell } from '../components/AppShell.js';
import { AiPanel } from '../components/AiPanel.js';
import { ErrorState } from '../components/ErrorState.js';
import { LoadingScreen } from '../components/LoadingScreen.js';
import { api, ApiError } from '../lib/api.js';
import type { DashboardResponse } from '../lib/types.js';
import { useSession } from '../session.js';

/** The AI Assistant application page (loads shell context + the panel). */
export function Assistant(): JSX.Element {
  const { data: session } = useSession();
  const [searchParams] = useSearchParams();

  const [state, setState] = useState<{
    dashboard: DashboardResponse | null;
    loading: boolean;
    error: ApiError | null;
  }>({ dashboard: null, loading: true, error: null });

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
      setState({ dashboard, loading: false, error: null });
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
            icon="✦"
            title="Create a workspace first"
            description="The AI Assistant is scoped per workspace. Set one up to start a conversation."
            action={
              <Button variant="secondary" onClick={() => void load()}>
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
      <div
        style={{
          maxWidth: 880,
          margin: '0 auto',
          height: 'calc(100vh - 120px)',
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        <div style={{ marginBottom: 16 }}>
          <h1 style={{ fontSize: typography.sizes['2xl'], fontWeight: typography.weights.bold }}>
            AI Assistant
          </h1>
          <p style={{ fontSize: typography.sizes.sm, color: 'var(--nexora-textSecondary)' }}>
            {dashboard.organization.name} · {dashboard.workspace.name} — your Nexora business
            operator.
          </p>
        </div>
        <div
          style={{
            flex: 1,
            minHeight: 0,
            borderRadius: 16,
            border: '1px solid var(--nexora-border)',
            overflow: 'hidden',
          }}
        >
          <AiPanel
            workspaceId={dashboard.workspace.id}
            organizationName={dashboard.organization.name}
            userDisplayName={dashboard.user.displayName}
          />
        </div>
      </div>
    </AppShell>
  );
}
