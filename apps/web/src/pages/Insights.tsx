/**
 * @nexora/app-web — Insights page (S23).
 *
 * The pilot measurement dashboard (PRD §20.4 / ROADMAP §23): a tenant-scoped
 * view of the pilot-readiness criteria computed from real persisted data —
 * workflow health (success rate, unrecoverable error rate, cycle time
 * p50/p95 per definition), onboarding progress (time to first workflow per
 * user), audit completeness (traceable event share + untraced types), and
 * tenant overview counts. Loading, empty, and error states mirror the other
 * application views; every metric is a single tenant-scoped SQL aggregation
 * behind `/api/insights` (never list-loading + client-side math).
 */

import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Badge, Card, EmptyState, Stack, typography } from '@nexora/design-system';

import { AppShell } from '../components/AppShell.js';
import { ErrorState } from '../components/ErrorState.js';
import { LoadingScreen } from '../components/LoadingScreen.js';
import { api, ApiError } from '../lib/api.js';
import type {
  AuditCompletenessMetricDto,
  DashboardResponse,
  InsightsResponse,
  OnboardingUserMetricDto,
  TenantMeasurementsDto,
  TenantOverviewDto,
  WorkflowHealthMetricDto,
} from '../lib/types.js';
import { useSession } from '../session.js';

/** Formats a duration in milliseconds as a human-readable string. */
function formatDuration(ms: number | null): string {
  if (ms === null) {
    return '—';
  }
  const minutes = Math.round(ms / 60_000);
  if (minutes < 1) {
    return `${Math.round(ms / 1000)}s`;
  }
  if (minutes < 60) {
    return `${minutes}min`;
  }
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}min`;
}

/** Formats a number as a percentage with one decimal. */
function formatPercent(value: number): string {
  return `${value.toFixed(1)}%`;
}

/** Whether a pilot criterion bar is met. */
function withinBar(actual: number, bar: number): boolean {
  return actual >= bar;
}

/** The insights application page. */
export function Insights(): JSX.Element {
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
            icon="📊"
            title="Create a workspace first"
            description="Insights are computed per workspace. Set one up to see your pilot metrics."
            action={
              <button onClick={() => void load()} type="button">
                Reload
              </button>
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
      <InsightsView
        organizationId={dashboard.organization.id}
        workspaceId={dashboard.workspace.id}
        organizationName={dashboard.organization.name}
      />
    </AppShell>
  );
}

/** Props of {@link InsightsView}. */
export interface InsightsViewProps {
  /** The current organization id (the trusted measurement scope). */
  organizationId: string;
  /** The current workspace id (the trusted measurement scope). */
  workspaceId: string;
  /** The current organization name. */
  organizationName: string;
  /** Optional preloaded measurements (server-rendered smoke tests). */
  initialMeasurements?: TenantMeasurementsDto | null;
}

/** The pure insights content (exported for smoke tests). */
export function InsightsView({
  organizationId,
  workspaceId,
  organizationName,
  initialMeasurements,
}: InsightsViewProps): JSX.Element {
  const [measurements, setMeasurements] = useState<TenantMeasurementsDto | null>(
    initialMeasurements ?? null,
  );
  // When the prop is absent the view loads from the API; smoke tests pass an
  // initial value (or null for the empty state) and skip the network fetch.
  const [loading, setLoading] = useState(initialMeasurements === undefined);
  const [error, setError] = useState<ApiError | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const scope = `organizationId=${encodeURIComponent(organizationId)}&workspaceId=${encodeURIComponent(workspaceId)}`;
      const response = await api<InsightsResponse>(`/insights?${scope}`);
      setMeasurements(response.measurements);
    } catch (caught) {
      setError(
        caught instanceof ApiError ? caught : new ApiError(0, 'INTERNAL_ERROR', 'Request failed'),
      );
    } finally {
      setLoading(false);
    }
  }, [organizationId, workspaceId]);

  useEffect(() => {
    if (initialMeasurements === undefined) {
      void load();
    }
  }, [load, initialMeasurements]);

  return (
    <Stack gap={8} style={{ maxWidth: 960, margin: '0 auto' }}>
      <Stack direction="row" gap={4} align="center" justify="space-between">
        <Stack gap={1}>
          <h1 style={{ fontSize: typography.sizes['2xl'], fontWeight: typography.weights.bold }}>
            Insights
          </h1>
          <p style={{ fontSize: typography.sizes.sm, color: 'var(--nexora-textSecondary)' }}>
            {organizationName} · pilot readiness measurements
          </p>
        </Stack>
        {measurements !== null ? (
          <Badge tone="primary" dot>
            {new Date(measurements.generatedAt).toLocaleString()}
          </Badge>
        ) : null}
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
          <EmptyState icon="📊" title="Loading insights…" description="Please wait." />
        </Card>
      ) : measurements === null ? (
        <Card>
          <EmptyState
            icon="📊"
            title="No measurements yet"
            description="Run a workflow to populate the pilot metrics."
          />
        </Card>
      ) : (
        <Stack gap={6}>
          <WorkflowHealthCard health={measurements.workflowHealth} />
          <OnboardingCard onboarding={measurements.onboarding} />
          <AuditCompletenessCard audit={measurements.auditCompleteness} />
          <OverviewCard overview={measurements.overview} />
        </Stack>
      )}
    </Stack>
  );
}

/** Workflow health section (PRD §20.4: success ≥ 85%, unrecoverable ≤ 1%). */
function WorkflowHealthCard({
  health,
}: {
  health: readonly WorkflowHealthMetricDto[];
}): JSX.Element {
  if (health.length === 0) {
    return (
      <Card>
        <h2 style={{ fontSize: typography.sizes.lg, fontWeight: typography.weights.semibold }}>
          Workflow health
        </h2>
        <EmptyState
          icon="⧉"
          title="No workflows yet"
          description="Workflow health appears when definitions start executing."
        />
      </Card>
    );
  }
  return (
    <Card>
      <Stack gap={3}>
        <h2 style={{ fontSize: typography.sizes.lg, fontWeight: typography.weights.semibold }}>
          Workflow health
        </h2>
        <div style={{ fontSize: typography.sizes.xs, color: 'var(--nexora-textMuted)' }}>
          Pilot bars: success rate ≥ 85% · unrecoverable error rate ≤ 1% (PRD §20.4)
        </div>
        <Stack gap={3}>
          {health.map((metric) => {
            const successMet = withinBar(metric.successRate, 85);
            const errorMet = metric.unrecoverableErrorRate <= 1;
            return (
              <Stack
                key={metric.definitionKey}
                gap={2}
                style={{ border: '1px solid var(--nexora-border)', borderRadius: 10, padding: 12 }}
              >
                <Stack direction="row" gap={3} align="center" justify="space-between">
                  <div style={{ fontWeight: typography.weights.semibold }}>
                    {metric.definitionKey}
                  </div>
                  <Stack direction="row" gap={2} align="center">
                    <Badge tone={successMet ? 'success' : 'warning'}>
                      {formatPercent(metric.successRate)} success
                    </Badge>
                    <Badge tone={errorMet ? 'success' : 'danger'}>
                      {formatPercent(metric.unrecoverableErrorRate)} unrecoverable
                    </Badge>
                  </Stack>
                </Stack>
                <div style={{ fontSize: typography.sizes.xs, color: 'var(--nexora-textMuted)' }}>
                  {metric.total} terminal runs ({metric.succeeded} succeeded · {metric.failed}{' '}
                  failed) · cycle time p50 {formatDuration(metric.cycleTimeP50Ms)} · p95{' '}
                  {formatDuration(metric.cycleTimeP95Ms)}
                </div>
              </Stack>
            );
          })}
        </Stack>
      </Stack>
    </Card>
  );
}

/** Onboarding section (PRD §20.4: time to first workflow ≤ 30 min). */
function OnboardingCard({
  onboarding,
}: {
  onboarding: readonly OnboardingUserMetricDto[];
}): JSX.Element {
  if (onboarding.length === 0) {
    return (
      <Card>
        <h2 style={{ fontSize: typography.sizes.lg, fontWeight: typography.weights.semibold }}>
          Onboarding
        </h2>
        <EmptyState
          icon="🚀"
          title="No users yet"
          description="Onboarding progress appears when users join the organization."
        />
      </Card>
    );
  }
  const timeBarMs = 30 * 60_000;
  return (
    <Card>
      <Stack gap={3}>
        <h2 style={{ fontSize: typography.sizes.lg, fontWeight: typography.weights.semibold }}>
          Onboarding
        </h2>
        <div style={{ fontSize: typography.sizes.xs, color: 'var(--nexora-textMuted)' }}>
          Pilot bar: time to first workflow ≤ 30 min (PRD §20.4)
        </div>
        <Stack gap={2}>
          {onboarding.map((user) => {
            const met =
              user.timeToFirstWorkflowMs !== null && user.timeToFirstWorkflowMs <= timeBarMs;
            return (
              <Stack
                key={user.userId}
                direction="row"
                gap={3}
                align="center"
                justify="space-between"
                style={{ border: '1px solid var(--nexora-border)', borderRadius: 10, padding: 10 }}
              >
                <Stack gap={0.5} style={{ minWidth: 0 }}>
                  <div style={{ fontWeight: typography.weights.medium }}>{user.email}</div>
                  <div style={{ fontSize: typography.sizes.xs, color: 'var(--nexora-textMuted)' }}>
                    signed up {new Date(user.signedUpAt).toLocaleString()}
                  </div>
                </Stack>
                {user.firstWorkflowAt === null ? (
                  <Badge>no workflow yet</Badge>
                ) : (
                  <Badge tone={met ? 'success' : 'warning'}>
                    {formatDuration(user.timeToFirstWorkflowMs)}
                  </Badge>
                )}
              </Stack>
            );
          })}
        </Stack>
      </Stack>
    </Card>
  );
}

/** Audit completeness section (PRD §20.4: traceable share bar 100%). */
function AuditCompletenessCard({ audit }: { audit: AuditCompletenessMetricDto }): JSX.Element {
  const met = audit.traceableShare >= 100;
  return (
    <Card>
      <Stack gap={3}>
        <Stack direction="row" gap={3} align="center" justify="space-between">
          <h2 style={{ fontSize: typography.sizes.lg, fontWeight: typography.weights.semibold }}>
            Audit completeness
          </h2>
          <Badge tone={met ? 'success' : 'warning'}>
            {formatPercent(audit.traceableShare)} traceable
          </Badge>
        </Stack>
        <div style={{ fontSize: typography.sizes.xs, color: 'var(--nexora-textMuted)' }}>
          {audit.tracedEvents} of {audit.totalEvents} business executions have an audit-trail entry.
        </div>
        {audit.untracedTypes.length > 0 ? (
          <Stack gap={2}>
            <div style={{ fontSize: typography.sizes.sm, color: 'var(--nexora-textSecondary)' }}>
              Untraced definitions:
            </div>
            <Stack direction="row" gap={2} style={{ flexWrap: 'wrap' }}>
              {audit.untracedTypes.map((type) => (
                <Badge key={type} tone="warning">
                  {type}
                </Badge>
              ))}
            </Stack>
          </Stack>
        ) : null}
      </Stack>
    </Card>
  );
}

/** Tenant overview counts section. */
function OverviewCard({ overview }: { overview: TenantOverviewDto }): JSX.Element {
  const rows: ReadonlyArray<{ label: string; value: number }> = [
    { label: 'Users', value: overview.users },
    { label: 'Workspaces', value: overview.workspaces },
    { label: 'Projects', value: overview.projects },
    { label: 'Documents', value: overview.documents },
    { label: 'Knowledge sources', value: overview.knowledgeSources },
    { label: 'Calendar events', value: overview.calendarEvents },
  ];
  return (
    <Card>
      <Stack gap={3}>
        <h2 style={{ fontSize: typography.sizes.lg, fontWeight: typography.weights.semibold }}>
          Tenant overview
        </h2>
        <Stack direction="row" gap={3} style={{ flexWrap: 'wrap' }}>
          {rows.map((row) => (
            <Stack
              key={row.label}
              gap={0.5}
              style={{
                border: '1px solid var(--nexora-border)',
                borderRadius: 10,
                padding: '10px 14px',
                minWidth: 130,
              }}
            >
              <div
                style={{ fontSize: typography.sizes['2xl'], fontWeight: typography.weights.bold }}
              >
                {row.value}
              </div>
              <div style={{ fontSize: typography.sizes.xs, color: 'var(--nexora-textMuted)' }}>
                {row.label}
              </div>
            </Stack>
          ))}
        </Stack>
      </Stack>
    </Card>
  );
}
