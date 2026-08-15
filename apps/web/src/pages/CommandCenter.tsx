/**
 * @nexora/app-web — Command Center page (S24 Phase 2).
 *
 * The GENERIC command-center page. There is ONE page for every role: the
 * server resolves the caller's effective business role from trusted
 * membership and returns the composed CommandCenterDefinition + widget data;
 * this page only renders. No CEOPage/ManagerPage/DeveloperPage exists — the
 * role determines the composition, never the page.
 *
 * Visual hierarchy (DESIGN_SYSTEM.md): identity/context header → actions →
 * widget grid (KPIs first, then attention/work/activity). Loading, empty,
 * and error states mirror the other application views.
 */

import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Link } from 'react-router-dom';
import { Badge, Button, Card, EmptyState, Stack, typography } from '@nexora/design-system';

import { AppShell } from '../components/AppShell.js';
import { CommandCenterWidget } from '../components/CommandCenterWidgets.js';
import { ErrorState } from '../components/ErrorState.js';
import { LoadingScreen } from '../components/LoadingScreen.js';
import { api, ApiError } from '../lib/api.js';
import type { CommandCenterDto, DashboardResponse } from '../lib/types.js';
import { useSession } from '../session.js';

/** The command-center application page (loads shell context + center). */
export function CommandCenter(): JSX.Element {
  const { data: session } = useSession();
  const [searchParams] = useSearchParams();

  const [state, setState] = useState<{
    dashboard: DashboardResponse | null;
    loading: boolean;
    error: ApiError | null;
  }>({ dashboard: null, loading: true, error: null });

  const load = useCallback(async () => {
    setState({ dashboard: null, loading: true, error: null });
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
      setState({
        dashboard: null,
        loading: false,
        error:
          error instanceof ApiError ? error : new ApiError(0, 'INTERNAL_ERROR', 'Request failed'),
      });
    }
  }, [searchParams]);

  useEffect(() => {
    void load();
  }, [load]);

  if (state.loading) {
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
            icon="◎"
            title="Create a workspace first"
            description="The Command Center is composed per workspace. Set one up to see your role-aware workspace."
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
      <CommandCenterView
        organizationId={dashboard.organization.id}
        workspaceId={dashboard.workspace.id}
        organizationName={dashboard.organization.name}
      />
    </AppShell>
  );
}

/** Props of {@link CommandCenterView}. */
export interface CommandCenterViewProps {
  /** The current organization id (trusted scope). */
  organizationId: string;
  /** The current workspace id (trusted scope). */
  workspaceId: string;
  /** The current organization name. */
  organizationName: string;
  /** Optional preloaded center (server-rendered smoke tests). */
  initialCenter?: CommandCenterDto | null;
}

/** The pure command-center content (exported for smoke tests). */
export function CommandCenterView({
  organizationId,
  workspaceId,
  organizationName,
  initialCenter,
}: CommandCenterViewProps): JSX.Element {
  const [center, setCenter] = useState<CommandCenterDto | null>(initialCenter ?? null);
  // When the prop is absent the view loads from the API; smoke tests pass an
  // initial value (or null for the empty state) and skip the network fetch.
  const [loading, setLoading] = useState(initialCenter === undefined);
  const [error, setError] = useState<ApiError | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const scope = `organizationId=${encodeURIComponent(organizationId)}&workspaceId=${encodeURIComponent(workspaceId)}`;
      const center = await api<CommandCenterDto>(`/command-center?${scope}`);
      setCenter(center);
    } catch (caught) {
      setError(
        caught instanceof ApiError ? caught : new ApiError(0, 'INTERNAL_ERROR', 'Request failed'),
      );
    } finally {
      setLoading(false);
    }
  }, [organizationId, workspaceId]);

  useEffect(() => {
    if (initialCenter === undefined) {
      void load();
    }
  }, [load, initialCenter]);

  return (
    <Stack gap={6} style={{ maxWidth: 1080, margin: '0 auto' }}>
      {/* Identity / context header */}
      <Stack
        direction="row"
        gap={4}
        align="center"
        justify="space-between"
        style={{ flexWrap: 'wrap' }}
      >
        <Stack gap={1}>
          <Stack direction="row" gap={2} align="center" style={{ flexWrap: 'wrap' }}>
            <h1 style={{ fontSize: typography.sizes['2xl'], fontWeight: typography.weights.bold }}>
              Command Center
            </h1>
            {center !== null ? (
              <Badge tone="primary" dot>
                {center.domainName} · {center.roleName}
              </Badge>
            ) : null}
          </Stack>
          <p style={{ fontSize: typography.sizes.sm, color: 'var(--nexora-textSecondary)' }}>
            {organizationName} · {center?.description ?? 'Your role-aware workspace'}
          </p>
        </Stack>
      </Stack>

      {error !== null ? (
        <Card>
          <div style={{ fontSize: typography.sizes.sm, color: 'var(--nexora-danger)' }}>
            {error.message}
          </div>
        </Card>
      ) : null}

      {loading ? (
        <Card>
          <EmptyState icon="◎" title="Composing your command center…" description="Please wait." />
        </Card>
      ) : center === null ? (
        <Card>
          <EmptyState
            icon="◎"
            title="No command center yet"
            description="Your role does not have a command center configured."
          />
        </Card>
      ) : (
        <Stack gap={6}>
          {/* Actions (read/navigation only in Phase 2) */}
          {center.actions.length > 0 ? (
            <Stack direction="row" gap={2} style={{ flexWrap: 'wrap' }}>
              {center.actions.map((action) => (
                <Link key={action.id} to={action.href} style={{ textDecoration: 'none' }}>
                  <Button variant="secondary" size="sm">
                    {action.icon !== undefined ? `${action.icon} ` : ''}
                    {action.label}
                  </Button>
                </Link>
              ))}
            </Stack>
          ) : null}

          {/* Widget grid: role-composed, one renderer per widget type */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
              gap: 16,
            }}
          >
            {center.widgets.map((widget) => (
              <CommandCenterWidget key={widget.id} widget={widget} data={center.data[widget.id]} />
            ))}
          </div>
        </Stack>
      )}
    </Stack>
  );
}
