/**
 * @nexora/app-web — Apps (Marketplace) page (S19).
 *
 * The Marketplace + Plugin Runtime application view (FRONTEND.md §7, PRD
 * §20.2): browse the app catalog of the current workspace, install an app
 * after reviewing the permissions it declares (an explicit confirm step —
 * never implicit consent), update an installed app to the catalog version,
 * and uninstall it. Every action goes through the same permission-filtered
 * API and lands in the workspace activity feed (full audit).
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Badge, Button, Card, EmptyState, Stack, typography } from '@nexora/design-system';

import { AppShell } from '../components/AppShell.js';
import { ErrorState } from '../components/ErrorState.js';
import { LoadingScreen } from '../components/LoadingScreen.js';
import { api, ApiError } from '../lib/api.js';
import type { DashboardResponse, InstalledAppDto, MarketplaceAppDto } from '../lib/types.js';
import { useSession } from '../session.js';

/** The marketplace application page. */
export function Apps(): JSX.Element {
  const { data: session } = useSession();
  const [searchParams] = useSearchParams();

  const [state, setState] = useState<{
    dashboard: DashboardResponse | null;
    apps: MarketplaceAppDto[];
    installed: InstalledAppDto[];
    loading: boolean;
    error: ApiError | null;
  }>({ dashboard: null, apps: [], installed: [], loading: true, error: null });

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
        setState({ dashboard, apps: [], installed: [], loading: false, error: null });
        return;
      }
      const scope = `organizationId=${encodeURIComponent(dashboard.organization.id)}&workspaceId=${encodeURIComponent(dashboard.workspace.id)}`;
      const [catalog, installed] = await Promise.all([
        api<{ apps: MarketplaceAppDto[] }>(`/marketplace/apps?${scope}`),
        api<{ apps: InstalledAppDto[] }>(`/marketplace/apps/installed?${scope}`),
      ]);
      setState({
        dashboard,
        apps: catalog.apps,
        installed: installed.apps,
        loading: false,
        error: null,
      });
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
            icon="▦"
            title="Create a workspace first"
            description="The marketplace installs apps into a workspace. Set one up to get started."
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
      <MarketplaceView
        organizationId={dashboard.organization.id}
        workspaceId={dashboard.workspace.id}
        initialApps={state.apps}
        initialInstalled={state.installed}
        onChanged={() => void load()}
      />
    </AppShell>
  );
}

/** Props of {@link MarketplaceView}. */
export interface MarketplaceViewProps {
  /** The current organization id (the trusted app scope). */
  organizationId: string;
  /** The current workspace id (the trusted app scope). */
  workspaceId: string;
  /** The catalog listings (with installed state). */
  initialApps: readonly MarketplaceAppDto[];
  /** The installed apps of the workspace. */
  initialInstalled: readonly InstalledAppDto[];
  /** Called after any lifecycle change (refresh the lists). */
  onChanged: () => void;
}

/** The pure marketplace content (exported for smoke tests). */
export function MarketplaceView({
  organizationId,
  workspaceId,
  initialApps,
  // The separate installed-apps read is available on the page API for
  // detail views; the catalog listings already carry `installed` +
  // `installedVersion`, so the badge derives from those (one source of
  // truth). Marked `_` for the no-unused-vars rule.
  initialInstalled: _initialInstalled,
  onChanged,
}: MarketplaceViewProps): JSX.Element {
  const [apps, setApps] = useState<MarketplaceAppDto[]>(() => [...initialApps]);
  const [reviewing, setReviewing] = useState<MarketplaceAppDto | null>(null);
  const [query, setQuery] = useState('');

  const installedCount = useMemo(() => apps.filter((app) => app.installed).length, [apps]);

  const visibleApps = useMemo(() => {
    const term = query.trim().toLowerCase();
    if (term.length === 0) {
      return apps;
    }
    return apps.filter(
      (app) =>
        app.name.toLowerCase().includes(term) ||
        app.summary.toLowerCase().includes(term) ||
        app.categories.some((category) => category.toLowerCase().includes(term)),
    );
  }, [apps, query]);

  const handleInstalled = useCallback(
    (app: MarketplaceAppDto, version: string) => {
      setApps((current) =>
        current.map((existing) =>
          existing.id === app.id
            ? { ...existing, installed: true, installedVersion: version }
            : existing,
        ),
      );
      onChanged();
    },
    [onChanged],
  );

  const handleUninstalled = useCallback(
    (appId: string) => {
      setApps((current) =>
        current.map((existing) =>
          existing.id === appId
            ? { ...existing, installed: false, installedVersion: undefined }
            : existing,
        ),
      );
      onChanged();
    },
    [onChanged],
  );

  return (
    <Stack gap={8} style={{ maxWidth: 960, margin: '0 auto' }}>
      <Stack direction="row" gap={4} align="center" justify="space-between">
        <Stack gap={1}>
          <h1 style={{ fontSize: typography.sizes['2xl'], fontWeight: typography.weights.bold }}>
            Apps
          </h1>
          <p style={{ fontSize: typography.sizes.sm, color: 'var(--nexora-textSecondary)' }}>
            Install apps for this workspace. Every install is audited in the activity feed.
          </p>
        </Stack>
        <Badge tone="primary" dot>
          {installedCount} installed
        </Badge>
      </Stack>

      <input
        id="marketplace-search"
        name="search"
        aria-label="Search marketplace"
        placeholder="Search apps…"
        value={query}
        onChange={(event) => setQuery(event.currentTarget.value)}
        style={{
          border: '1px solid var(--nexora-border)',
          borderRadius: 8,
          padding: '10px 12px',
          fontSize: typography.sizes.sm,
          background: 'var(--nexora-surface)',
          color: 'var(--nexora-text)',
          maxWidth: 420,
        }}
      />

      {visibleApps.length === 0 ? (
        <Card>
          <EmptyState
            icon="▦"
            title={query.trim().length > 0 ? 'No apps match' : 'No apps in the catalog'}
            description={
              query.trim().length > 0
                ? 'Try a different search.'
                : 'The catalog is empty for this workspace.'
            }
          />
        </Card>
      ) : (
        <Stack gap={3}>
          {visibleApps.map((app) => (
            <AppCard
              key={app.id}
              app={app}
              organizationId={organizationId}
              workspaceId={workspaceId}
              onInstall={handleInstalled}
              onUninstall={handleUninstalled}
              onReview={() => setReviewing(app)}
              onReviewClose={() => setReviewing(null)}
              reviewing={reviewing?.id === app.id}
            />
          ))}
        </Stack>
      )}
    </Stack>
  );
}

/** One marketplace app card with install / update / uninstall actions. */
function AppCard({
  app,
  organizationId,
  workspaceId,
  onInstall,
  onUninstall,
  onReview,
  onReviewClose,
  reviewing,
}: {
  app: MarketplaceAppDto;
  organizationId: string;
  workspaceId: string;
  onInstall: (app: MarketplaceAppDto, version: string) => void;
  onUninstall: (appId: string) => void;
  onReview: () => void;
  onReviewClose: () => void;
  reviewing: boolean;
}): JSX.Element {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);

  const handleInstall = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const result = await api<{ installationId: string; appId: string; version: string }>(
        `/marketplace/apps/${encodeURIComponent(app.id)}/install`,
        {
          method: 'POST',
          body: JSON.stringify({ organizationId, workspaceId, permissionsConfirmed: true }),
        },
      );
      onInstall(app, result.version);
      onReviewClose();
    } catch (caught) {
      setError(
        caught instanceof ApiError ? caught : new ApiError(0, 'INTERNAL_ERROR', 'Install failed'),
      );
    } finally {
      setBusy(false);
    }
  }, [app, organizationId, workspaceId, onInstall, onReviewClose]);

  const handleUpdate = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const result = await api<{ installationId: string; version: string }>(
        `/marketplace/apps/${encodeURIComponent(app.id)}/update`,
        {
          method: 'POST',
          body: JSON.stringify({ organizationId, workspaceId }),
        },
      );
      onInstall(app, result.version);
    } catch (caught) {
      setError(
        caught instanceof ApiError ? caught : new ApiError(0, 'INTERNAL_ERROR', 'Update failed'),
      );
    } finally {
      setBusy(false);
    }
  }, [app, organizationId, workspaceId, onInstall]);

  const handleUninstall = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      await api<{ appId: string }>(`/marketplace/apps/${encodeURIComponent(app.id)}/uninstall`, {
        method: 'POST',
        body: JSON.stringify({ organizationId, workspaceId }),
      });
      onUninstall(app.id);
    } catch (caught) {
      setError(
        caught instanceof ApiError ? caught : new ApiError(0, 'INTERNAL_ERROR', 'Uninstall failed'),
      );
    } finally {
      setBusy(false);
    }
  }, [app, organizationId, workspaceId, onUninstall]);

  return (
    <Card style={{ padding: '16px 18px' }}>
      <Stack gap={3}>
        <Stack direction="row" gap={4} align="center" justify="space-between">
          <Stack gap={0.5} style={{ minWidth: 0 }}>
            <Stack direction="row" gap={3} align="center">
              <div style={{ fontWeight: typography.weights.semibold }}>{app.name}</div>
              {app.installed ? (
                <Badge tone="success" dot>
                  Installed v{app.installedVersion ?? app.version}
                </Badge>
              ) : (
                <Badge>Not installed</Badge>
              )}
            </Stack>
            <span style={{ fontSize: typography.sizes.sm, color: 'var(--nexora-textSecondary)' }}>
              {app.summary}
            </span>
            <Stack direction="row" gap={3} align="center">
              <span style={{ fontSize: typography.sizes.xs, color: 'var(--nexora-textMuted)' }}>
                by {app.publisher} · v{app.version}
              </span>
              {app.categories.map((category) => (
                <span
                  key={category}
                  style={{
                    fontSize: typography.sizes.xs,
                    color: 'var(--nexora-textMuted)',
                    border: '1px solid var(--nexora-border)',
                    borderRadius: 999,
                    padding: '1px 8px',
                  }}
                >
                  {category}
                </span>
              ))}
            </Stack>
          </Stack>
          <Stack direction="row" gap={3} align="center">
            {!app.installed ? (
              <Button size="sm" onClick={onReview}>
                Install
              </Button>
            ) : (
              <>
                {app.installedVersion !== app.version ? (
                  <Button
                    size="sm"
                    onClick={() => void handleUpdate()}
                    disabled={busy}
                    loading={busy}
                  >
                    Update to v{app.version}
                  </Button>
                ) : (
                  <Badge>Up to date</Badge>
                )}
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => void handleUninstall()}
                  disabled={busy}
                >
                  Uninstall
                </Button>
              </>
            )}
          </Stack>
        </Stack>

        {error !== null ? (
          <div style={{ fontSize: typography.sizes.sm, color: 'var(--nexora-danger)' }}>
            {error.message}
          </div>
        ) : null}

        {reviewing ? (
          <PermissionReview
            app={app}
            onConfirm={() => void handleInstall()}
            onCancel={onReviewClose}
            busy={busy}
          />
        ) : null}
      </Stack>
    </Card>
  );
}

/** The install-time permission review (explicit consent, PRD §20.2). */
function PermissionReview({
  app,
  onConfirm,
  onCancel,
  busy,
}: {
  app: MarketplaceAppDto;
  onConfirm: () => void;
  onCancel: () => void;
  busy: boolean;
}): JSX.Element {
  return (
    <Card style={{ background: 'var(--nexora-primarySoft)', padding: '14px 16px' }}>
      <Stack gap={3}>
        <div style={{ fontWeight: typography.weights.semibold }}>
          Review permissions for {app.name}
        </div>
        <p
          style={{ fontSize: typography.sizes.sm, color: 'var(--nexora-textSecondary)', margin: 0 }}
        >
          Installing grants this app the following scopes in this workspace:
        </p>
        <Stack gap={2}>
          {app.grantedPermissions.map((scope) => (
            <Stack key={scope} direction="row" gap={3} align="center">
              <Badge tone={app.requiredPermissions.includes(scope) ? 'warning' : 'primary'}>
                {scope}
              </Badge>
              <span style={{ fontSize: typography.sizes.xs, color: 'var(--nexora-textMuted)' }}>
                {app.requiredPermissions.includes(scope) ? 'required' : 'granted'}
              </span>
            </Stack>
          ))}
        </Stack>
        <Stack direction="row" gap={3} align="center" justify="flex-end">
          <Button size="sm" variant="ghost" onClick={onCancel} disabled={busy}>
            Cancel
          </Button>
          <Button size="sm" onClick={onConfirm} disabled={busy} loading={busy}>
            {busy ? 'Installing…' : 'Confirm & install'}
          </Button>
        </Stack>
      </Stack>
    </Card>
  );
}
