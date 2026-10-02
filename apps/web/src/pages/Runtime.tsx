/**
 * @nexora/app-web — Runtime Runs page.
 *
 * The operator view of HOW the AI runtime performed, complementing the
 * Audit Center (what happened). It reads `GET /api/ops/runtime/*`, which is
 * gated by the SAME `audit.read` capability as the Audit page: the sidebar
 * hides "Runtime" for other roles and the fetch fails closed with a 403.
 *
 * Only known, safe fields are rendered (ids, codes, durations, counts).
 * Unknown facts stay unknown: unreported token usage reads "usage not
 * reported" and an unpriced cost reads "cost unavailable" — never 0.
 */

import { useCallback, useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  Select,
  Skeleton,
  Stack,
  typography,
} from '@nexora/design-system';

import { AppShell } from '../components/AppShell.js';
import { ErrorState } from '../components/ErrorState.js';
import { LoadingScreen } from '../components/LoadingScreen.js';
import { api, ApiError } from '../lib/api.js';
import { executionAuthorityLabel, verificationLabel } from '../lib/governance.js';
import {
  RUNTIME_STAGES,
  type DashboardResponse,
  type RuntimeGovernanceDto,
  type RuntimeMetricsDto,
  type RuntimeModelCall,
  type RuntimeRunDetailDto,
  type RuntimeRunDto,
  type RuntimeStatus,
  type RuntimeTimelineEntry,
} from '../lib/types.js';
import { useSession } from '../session.js';

const STATUSES: readonly RuntimeStatus[] = ['completed', 'failed', 'blocked', 'clarification'];

/** Filters applied server-side. */
export interface RuntimeFilters {
  status: RuntimeStatus | 'all';
  failureStage: (typeof RUNTIME_STAGES)[number] | 'all';
}

const toError = (error: unknown): ApiError =>
  error instanceof ApiError ? error : new ApiError(0, 'INTERNAL_ERROR', 'Request failed');

/** The Runtime Runs application page. */
export function Runtime(): JSX.Element {
  const { data: session } = useSession();
  const [searchParams] = useSearchParams();

  const [dashboard, setDashboard] = useState<DashboardResponse | null>(null);
  const [dashboardError, setDashboardError] = useState<ApiError | null>(null);
  const [runs, setRuns] = useState<RuntimeRunDto[]>([]);
  const [metrics, setMetrics] = useState<RuntimeMetricsDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<ApiError | null>(null);
  const [filters, setFilters] = useState<RuntimeFilters>({ status: 'all', failureStage: 'all' });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<RuntimeRunDetailDto | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);

  const organizationId = dashboard?.organization?.id;
  const workspaceId = dashboard?.workspace?.id;

  const loadDashboard = useCallback(async () => {
    setDashboardError(null);
    try {
      const params = new URLSearchParams();
      const org = searchParams.get('organizationId');
      const ws = searchParams.get('workspaceId');
      if (org !== null) params.set('organizationId', org);
      if (ws !== null) params.set('workspaceId', ws);
      const suffix = params.size > 0 ? `?${params.toString()}` : '';
      setDashboard(await api<DashboardResponse>(`/dashboard${suffix}`));
    } catch (caught) {
      setDashboardError(toError(caught));
    }
  }, [searchParams]);

  useEffect(() => {
    void loadDashboard();
  }, [loadDashboard]);

  const loadRuns = useCallback(async () => {
    if (organizationId === undefined || workspaceId === undefined) return;
    setLoading(true);
    setError(null);
    try {
      const scope = `organizationId=${encodeURIComponent(organizationId)}&workspaceId=${encodeURIComponent(workspaceId)}`;
      const query = new URLSearchParams();
      if (filters.status !== 'all') query.set('status', filters.status);
      if (filters.failureStage !== 'all') query.set('failureStage', filters.failureStage);
      query.set('limit', '50');
      const [listed, summary] = await Promise.all([
        api<{ runs: RuntimeRunDto[] }>(`/ops/runtime/runs?${scope}&${query.toString()}`),
        api<RuntimeMetricsDto>(`/ops/runtime/metrics?${scope}`),
      ]);
      setRuns(listed.runs);
      setMetrics(summary);
    } catch (caught) {
      setError(toError(caught));
    } finally {
      setLoading(false);
    }
  }, [organizationId, workspaceId, filters]);

  useEffect(() => {
    void loadRuns();
  }, [loadRuns]);

  const select = useCallback(
    async (runId: string) => {
      if (organizationId === undefined || workspaceId === undefined) return;
      setSelectedId(runId);
      setDetail(null);
      setDetailError(null);
      setDetailLoading(true);
      try {
        setDetail(
          await api<RuntimeRunDetailDto>(
            `/ops/runtime/runs/${encodeURIComponent(runId)}?organizationId=${encodeURIComponent(organizationId)}&workspaceId=${encodeURIComponent(workspaceId)}`,
          ),
        );
      } catch (caught) {
        setDetailError(toError(caught).message);
      } finally {
        setDetailLoading(false);
      }
    },
    [organizationId, workspaceId],
  );

  if (dashboardError !== null) {
    return <ErrorState message={dashboardError.message} onRetry={() => void loadDashboard()} />;
  }
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
            icon="🛡"
            title="Create a workspace first"
            description="Runtime telemetry is scoped to a workspace. Set one up to get started."
            action={
              <Button size="lg" onClick={() => void loadDashboard()}>
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
      <RuntimeView
        organizationName={dashboard.organization.name}
        workspaceName={dashboard.workspace.name}
        runs={runs}
        metrics={metrics}
        loading={loading}
        error={error?.message ?? null}
        filters={filters}
        onFiltersChange={setFilters}
        selectedId={selectedId}
        onSelect={(runId) => void select(runId)}
        detail={detail}
        detailLoading={detailLoading}
        detailError={detailError}
        onRefresh={() => void loadRuns()}
        scope={{ organizationId: dashboard.organization.id, workspaceId: dashboard.workspace.id }}
      />
    </AppShell>
  );
}

/** Formats a duration. */
export function formatMs(ms: number): string {
  return ms >= 1000 ? `${(ms / 1000).toFixed(2)} s` : `${Math.round(ms)} ms`;
}

const formatMsOrDash = (ms: number | null): string => (ms === null ? '—' : formatMs(ms));

function formatWhen(iso: string): string {
  return new Date(iso).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function statusTone(status: RuntimeStatus): 'success' | 'danger' | 'warning' | 'neutral' {
  if (status === 'completed') return 'success';
  if (status === 'failed') return 'danger';
  if (status === 'blocked') return 'warning';
  return 'neutral';
}

/** Token usage, or an honest "not reported" (never 0 for unknown). */
export function usageLabel(usage: {
  available: boolean;
  total?: number;
  prompt?: number;
  completion?: number;
}): string {
  if (!usage.available) return 'usage not reported';
  return `${usage.total ?? 0} tokens (${usage.prompt ?? 0} in / ${usage.completion ?? 0} out)`;
}

/** Cost, or an honest "cost unavailable" (never 0 for unknown). */
export function costLabel(cost: number | null | undefined, currency?: string): string {
  if (cost === null || cost === undefined) return 'cost unavailable';
  return `${cost} ${currency ?? ''}`.trim();
}

const modelLabel = (run: RuntimeRunDto): string =>
  run.model !== undefined
    ? `${run.provider !== undefined ? `${run.provider}/` : ''}${run.model}`
    : (run.provider ?? '—');

/** Props of {@link RuntimeView}. */
export interface RuntimeViewProps {
  organizationName: string;
  workspaceName: string;
  runs: readonly RuntimeRunDto[];
  metrics: RuntimeMetricsDto | null;
  loading: boolean;
  /** A load error message (e.g. a 403 for a role without `audit.read`). */
  error: string | null;
  filters: RuntimeFilters;
  onFiltersChange: (filters: RuntimeFilters) => void;
  selectedId: string | null;
  onSelect: (runId: string) => void;
  detail: RuntimeRunDetailDto | null;
  detailLoading: boolean;
  detailError: string | null;
  onRefresh: () => void;
  /** The page's trusted scope (used to link a run to its Audit Center trace). */
  scope?: { organizationId: string; workspaceId: string };
}

/** The pure Runtime Runs content (exported for smoke tests). */
export function RuntimeView({
  organizationName,
  workspaceName,
  runs,
  metrics,
  loading,
  error,
  filters,
  onFiltersChange,
  selectedId,
  onSelect,
  detail,
  detailLoading,
  detailError,
  onRefresh,
  scope,
}: RuntimeViewProps): JSX.Element {
  return (
    <Stack gap={6} style={{ maxWidth: 1400, margin: '0 auto' }}>
      <Stack
        direction="row"
        gap={4}
        align="center"
        justify="space-between"
        style={{ flexWrap: 'wrap' }}
      >
        <Stack gap={1}>
          <h1 className="nexora-page-title">Runtime Runs</h1>
          <p style={{ fontSize: typography.sizes.sm, color: 'var(--nexora-textSecondary)' }}>
            {organizationName} · {workspaceName} — how the AI runtime performed
          </p>
        </Stack>
        <Button
          size="sm"
          variant="secondary"
          onClick={onRefresh}
          disabled={loading}
          loading={loading}
        >
          Refresh
        </Button>
      </Stack>

      {error !== null ? (
        <Card>
          <ErrorState message={error} onRetry={onRefresh} />
        </Card>
      ) : (
        <>
          {metrics !== null ? <MetricsStrip metrics={metrics} /> : null}

          <Card style={{ padding: '14px 16px' }}>
            <Stack direction="row" gap={3} align="center" style={{ flexWrap: 'wrap' }}>
              <div style={{ minWidth: 180 }}>
                <Select
                  aria-label="Filter by status"
                  value={filters.status}
                  onChange={(event) =>
                    onFiltersChange({
                      ...filters,
                      status: event.currentTarget.value as RuntimeFilters['status'],
                    })
                  }
                >
                  <option value="all">All statuses</option>
                  {STATUSES.map((status) => (
                    <option key={status} value={status}>
                      {status}
                    </option>
                  ))}
                </Select>
              </div>
              <div style={{ minWidth: 200 }}>
                <Select
                  aria-label="Filter by failure stage"
                  value={filters.failureStage}
                  onChange={(event) =>
                    onFiltersChange({
                      ...filters,
                      failureStage: event.currentTarget.value as RuntimeFilters['failureStage'],
                    })
                  }
                >
                  <option value="all">Any failure stage</option>
                  {RUNTIME_STAGES.map((stage) => (
                    <option key={stage} value={stage}>
                      {stage}
                    </option>
                  ))}
                </Select>
              </div>
              <span style={{ fontSize: typography.sizes.xs, color: 'var(--nexora-textMuted)' }}>
                {runs.length} runs
              </span>
            </Stack>
          </Card>

          <div className="nexora-runtime-layout">
            <div className="nexora-runtime-main">
              {loading ? (
                <Card>
                  <Stack gap={3}>
                    <Skeleton height={18} />
                    <Skeleton height={18} />
                    <Skeleton height={18} />
                  </Stack>
                </Card>
              ) : runs.length === 0 ? (
                <Card>
                  <EmptyState
                    icon="🛡"
                    title="No runtime runs"
                    description="Nothing matches the current filters yet."
                  />
                </Card>
              ) : (
                <div className="nexora-runtime-table-wrap">
                  <table className="nexora-runtime-table">
                    <thead>
                      <tr>
                        <th>Time</th>
                        <th>Status</th>
                        <th>Duration</th>
                        <th>Actor</th>
                        <th>Agent</th>
                        <th>Model</th>
                        <th>Tool Calls</th>
                        <th>Approvals</th>
                        <th>Failure Stage</th>
                      </tr>
                    </thead>
                    <tbody>
                      {runs.map((run) => (
                        <tr
                          key={run.id}
                          role="button"
                          tabIndex={0}
                          aria-label={`Run ${run.id} — ${run.status}`}
                          className={
                            run.id === selectedId ? 'nexora-runtime-row-selected' : undefined
                          }
                          onClick={() => onSelect(run.id)}
                          onKeyDown={(keyEvent) => {
                            if (keyEvent.key === 'Enter' || keyEvent.key === ' ') {
                              keyEvent.preventDefault();
                              onSelect(run.id);
                            }
                          }}
                        >
                          <td>{formatWhen(run.startedAt)}</td>
                          <td>
                            <Badge tone={statusTone(run.status)}>{run.status}</Badge>
                          </td>
                          <td>{formatMs(run.durationMs)}</td>
                          <td>{run.actorId}</td>
                          <td>{run.agentId ?? '—'}</td>
                          <td>{modelLabel(run)}</td>
                          <td>{run.tools.length}</td>
                          <td>
                            {run.approval === undefined
                              ? '—'
                              : run.approval.state === 'expired'
                                ? 'Expired'
                                : 'Yes'}
                          </td>
                          <td>{run.failure?.stage ?? '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            <div className="nexora-runtime-detail">
              {selectedId === null ? (
                <Card>
                  <EmptyState
                    icon="🛡"
                    title="Select a run"
                    description="Choose a row to see its timeline."
                  />
                </Card>
              ) : detailLoading ? (
                <Card>
                  <Stack gap={3}>
                    <Skeleton height={18} />
                    <Skeleton height={18} />
                  </Stack>
                </Card>
              ) : detailError !== null ? (
                <Card>
                  <p style={{ color: 'var(--nexora-danger)', fontSize: typography.sizes.sm }}>
                    {detailError}
                  </p>
                </Card>
              ) : detail !== null ? (
                <RunDetail detail={detail} scope={scope} />
              ) : null}
            </div>
          </div>
        </>
      )}

      <style>{`
        .nexora-runtime-metrics { display: grid; grid-template-columns: repeat(6, minmax(0, 1fr)); gap: 12px; }
        .nexora-runtime-layout { display: grid; grid-template-columns: minmax(0, 1fr) 380px; gap: 20px; align-items: start; }
        .nexora-runtime-table-wrap { overflow-x: auto; }
        .nexora-runtime-table { width: 100%; min-width: 860px; border-collapse: collapse; font-size: ${typography.sizes.sm}; }
        .nexora-runtime-table thead th {
          text-align: left; padding: 10px 12px; font-size: ${typography.sizes.xs};
          font-weight: ${typography.weights.medium}; color: var(--nexora-textMuted);
          border-bottom: 1px solid var(--nexora-border); white-space: nowrap;
        }
        .nexora-runtime-table tbody td {
          padding: 10px 12px; border-bottom: 1px solid var(--nexora-border);
          white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 200px;
        }
        .nexora-runtime-table tbody tr { cursor: pointer; background: var(--nexora-surface); }
        .nexora-runtime-table tbody tr:hover { background: var(--nexora-surfaceMuted); }
        .nexora-runtime-row-selected td { background: var(--nexora-primarySoft); }
        @media (max-width: 1024px) {
          .nexora-runtime-metrics { grid-template-columns: repeat(3, minmax(0, 1fr)); }
          .nexora-runtime-layout { grid-template-columns: minmax(0, 1fr); }
        }
        @media (max-width: 640px) {
          .nexora-runtime-metrics { grid-template-columns: repeat(2, minmax(0, 1fr)); }
        }
      `}</style>
    </Stack>
  );
}

/** The small metrics strip, with its window. */
export function MetricsStrip({ metrics }: { metrics: RuntimeMetricsDto }): JSX.Element {
  const { summary } = metrics;
  const cards: [string, string][] = [
    ['Runs', String(summary.runs)],
    ['Failure rate', `${(summary.failureRate * 100).toFixed(1)}%`],
    ['p50 latency', formatMsOrDash(summary.latencyMs.p50)],
    ['p95 latency', formatMsOrDash(summary.latencyMs.p95)],
    ['Tool failures', `${summary.tools.failed} / ${summary.tools.calls}`],
    ['Model failures', `${summary.models.failed} / ${summary.models.calls}`],
    ['Policy denials', String(summary.policyDenials)],
  ];
  // Approval counters exist only on servers that report them.
  if (summary.approvals !== undefined) {
    cards.push(
      ['Approvals opened', String(summary.approvals.opened)],
      ['Approvals resumed', String(summary.approvals.resumed)],
      ['Approvals rejected', String(summary.approvals.rejected)],
      ['Approvals expired', String(summary.approvals.expired)],
    );
  }
  return (
    <Stack gap={2}>
      <div style={{ fontSize: typography.sizes.xs, color: 'var(--nexora-textMuted)' }}>
        Window: {formatWhen(metrics.window.from)} – {formatWhen(metrics.window.to)}
        {metrics.truncated ? ' (truncated to the newest runs)' : ''}
      </div>
      <div className="nexora-runtime-metrics">
        {cards.map(([label, value]) => (
          <Card key={label} style={{ padding: '12px 14px' }}>
            <Stack gap={1}>
              <div style={{ fontSize: typography.sizes.xl, fontWeight: typography.weights.bold }}>
                {value}
              </div>
              <div style={{ fontSize: typography.sizes.xs, color: 'var(--nexora-textMuted)' }}>
                {label}
              </div>
            </Stack>
          </Card>
        ))}
      </div>
    </Stack>
  );
}

const str = (value: unknown): string | undefined =>
  typeof value === 'string' && value.length > 0 ? value : undefined;
const num = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) ? value : undefined;

/** Reads ONLY an allow-list of safe fields from a timeline item. */
function safeFacts(stage: RuntimeTimelineEntry['stage'], item: Readonly<Record<string, unknown>>) {
  const facts: [string, string][] = [];
  const add = (label: string, value: string | number | undefined): void => {
    if (value !== undefined) facts.push([label, String(value)]);
  };
  if (stage === 'POLICY') {
    add('Policy', str(item['policyId']));
    add('Version', str(item['version']));
    add('Outcome', str(item['outcome']));
    add('Phase', str(item['phase']));
  } else if (stage === 'APPROVAL') {
    add('Approval', str(item['approvalId']));
    add('State', str(item['state']));
    add('Decision', str(item['decision']));
    const wait = num(item['waitMs']);
    if (wait !== undefined) add('Human wait', formatMs(wait));
  } else if (stage === 'NARRATION') {
    add('Provider', str(item['provider']));
    add('Model', str(item['model']));
    const execution = str(item['execution']);
    if (execution !== undefined) {
      add('Execution', execution === 'unknown' ? 'local/cloud unknown' : execution);
    }
    add('Status', str(item['status']));
    add('Error', str(item['errorCode']));
    add(
      'Usage',
      usageLabel({
        available: item['usageAvailable'] === true,
        total: num(item['totalTokens']),
        prompt: num(item['promptTokens']),
        completion: num(item['completionTokens']),
      }),
    );
    const cost = item['cost'];
    add('Cost', costLabel(typeof cost === 'number' ? cost : null, str(item['currency'])));
  } else {
    add('Tool', str(item['toolId']));
    add('Invocation', str(item['invocationId']));
    add('Status', str(item['status']));
    const duration = num(item['durationMs']);
    if (duration !== undefined) add('Duration', formatMs(duration));
    add('Error', str(item['errorCode']));
    add('Approval', str(item['approvalId']));
    add('Delegation', str(item['delegationId']));
    const policy = item['policy'];
    if (typeof policy === 'object' && policy !== null) {
      const ref = policy as Record<string, unknown>;
      const id = str(ref['policyId']);
      if (id !== undefined) {
        add('Policy', `${id} v${str(ref['version']) ?? '?'} → ${str(ref['outcome']) ?? '?'}`);
      }
    }
  }
  return facts;
}

function ModelSummary({ model }: { model: RuntimeModelCall }): JSX.Element {
  return (
    <div style={{ fontSize: typography.sizes.xs, color: 'var(--nexora-textSecondary)' }}>
      {model.provider}
      {model.model !== undefined ? `/${model.model}` : ''} ·{' '}
      {model.execution === 'unknown' ? 'local/cloud unknown' : model.execution} ·{' '}
      {usageLabel({
        available: model.usageAvailable,
        total: model.totalTokens,
        prompt: model.promptTokens,
        completion: model.completionTokens,
      })}{' '}
      · {costLabel(model.cost, model.currency)}
    </div>
  );
}

function GovRow({ label, children }: { label: string; children: React.ReactNode }): JSX.Element {
  return (
    <div style={{ display: 'flex', gap: 8, fontSize: typography.sizes.sm, padding: '2px 0' }}>
      <span style={{ color: 'var(--nexora-textMuted)', minWidth: 130 }}>{label}</span>
      <span style={{ overflowWrap: 'anywhere' }}>{children}</span>
    </div>
  );
}

/** Who requested / approved / executed, and how each execution was verified. */
export function GovernanceSection({
  governance,
  scope,
}: {
  governance: RuntimeGovernanceDto;
  /** The trusted scope the Audit Center link carries (the page's own scope). */
  scope?: { organizationId: string; workspaceId: string };
}): JSX.Element {
  const { actors, approval, executions, links } = governance;
  const fp = approval?.approvedInputFingerprint;
  return (
    <Stack gap={1} data-testid="run-governance">
      <div style={{ fontSize: typography.sizes.xs, color: 'var(--nexora-textMuted)' }}>
        Governance
      </div>
      <GovRow label="Requested by">
        {actors.requester.name ?? actors.requester.userId}
        {actors.requester.name !== undefined ? ` (${actors.requester.userId})` : ''}
      </GovRow>
      <GovRow label="Acted by (agent)">
        {actors.agent !== undefined
          ? `${actors.agent.agentId}${
              actors.agent.delegationId !== undefined
                ? ` · delegation ${actors.agent.delegationId}`
                : ''
            }`
          : 'no agent involved'}
      </GovRow>
      <GovRow label="Approved by">
        {actors.approver !== undefined
          ? `${actors.approver.name ?? actors.approver.userId} (${actors.approver.userId}) · ${formatWhen(actors.approver.decidedAt)}`
          : approval === undefined
            ? 'no approval required'
            : 'not yet approved'}
      </GovRow>
      <GovRow label="Executed as">
        {actors.executor.kind === 'agent'
          ? `agent ${actors.executor.agentId ?? ''}`.trim()
          : 'user'}{' '}
        ({actors.executor.userId}) — {executionAuthorityLabel(actors.executionAuthority)}
      </GovRow>
      {approval !== undefined ? (
        <>
          <GovRow label="Approval">
            <Badge tone={approval.status === 'approved' ? 'success' : 'neutral'}>
              {approval.status}
            </Badge>{' '}
            <Badge tone={approval.separationOfDuties ? 'success' : 'neutral'}>
              {approval.separationOfDuties
                ? 'Separation of duties enforced'
                : 'Separation of duties not required'}
            </Badge>
          </GovRow>
          {approval.requiredApproverRoleId !== undefined ? (
            <GovRow label="Approver role">{approval.requiredApproverRoleId}</GovRow>
          ) : null}
          {fp !== undefined ? (
            <GovRow label="Approved input">
              <span title={fp} style={{ fontFamily: typography.fontMono }}>
                {fp.length > 12 ? `${fp.slice(0, 12)}…` : fp}
              </span>
            </GovRow>
          ) : null}
        </>
      ) : null}
      {executions.length > 0 ? (
        <ul style={{ margin: '4px 0', paddingLeft: 16, fontSize: typography.sizes.xs }}>
          {executions.map((x) => (
            <li key={x.invocationId} style={{ marginBottom: 6 }}>
              <div>
                {x.toolId} · {x.status}
                {x.matchesApproved !== undefined
                  ? ` · matches approved input: ${x.matchesApproved ? 'yes' : 'no'}`
                  : ''}
              </div>
              <div style={{ color: 'var(--nexora-textMuted)' }}>
                {verificationLabel(x.verification)} ({x.verification.source})
                {x.verification.limitation !== undefined
                  ? ` · Limitation: ${x.verification.limitation}`
                  : ''}
              </div>
            </li>
          ))}
        </ul>
      ) : null}
      {links.auditEventId !== null ? (
        <GovRow label="Audit trace">
          {scope === undefined ? (
            <span style={{ color: 'var(--nexora-textMuted)' }}>Recorded in the Audit Center</span>
          ) : (
            <Link
              to={`/app/audit?${new URLSearchParams({
                organizationId: scope.organizationId,
                workspaceId: scope.workspaceId,
                event: links.auditEventId,
              }).toString()}`}
            >
              Open the decision trace in the Audit Center →
            </Link>
          )}
        </GovRow>
      ) : null}
    </Stack>
  );
}

/** The detail panel of one run: timeline, failure, bottleneck, usage. */
export function RunDetail({
  detail,
  scope,
}: {
  detail: RuntimeRunDetailDto;
  scope?: { organizationId: string; workspaceId: string };
}): JSX.Element {
  const { run, timeline, bottleneck } = detail;
  const slowest =
    bottleneck.tool !== undefined
      ? `tool ${bottleneck.tool.toolId} (${formatMs(bottleneck.tool.durationMs)})`
      : bottleneck.model !== undefined
        ? `model ${bottleneck.model.provider} (${formatMs(bottleneck.model.durationMs)})`
        : bottleneck.stage !== undefined
          ? `stage ${bottleneck.stage.stage} (${formatMs(bottleneck.stage.durationMs)})`
          : undefined;
  return (
    <Card>
      <Stack gap={4}>
        <Stack gap={1}>
          <Stack direction="row" gap={2} align="center">
            <Badge tone={statusTone(run.status)}>{run.status}</Badge>
            <span style={{ fontSize: typography.sizes.xs, fontFamily: typography.fontMono }}>
              {run.id}
            </span>
          </Stack>
          <div style={{ fontSize: typography.sizes.sm, color: 'var(--nexora-textSecondary)' }}>
            Duration {formatMs(run.durationMs)}
            {run.approval?.waitMs !== undefined
              ? ` · Approval wait ${formatMs(run.approval.waitMs)} (separate)`
              : ''}
            {run.approval?.state === 'expired' ? ' · Approval expired' : ''}
          </div>
        </Stack>

        {run.failure !== undefined ? (
          <div
            style={{
              padding: '10px 12px',
              borderRadius: 8,
              background: 'var(--nexora-surfaceMuted)',
              color: 'var(--nexora-danger)',
              fontSize: typography.sizes.sm,
            }}
          >
            Failed at {run.failure.stage}: {run.failure.code} ({run.failure.class})
          </div>
        ) : null}

        {slowest !== undefined ? (
          <div style={{ fontSize: typography.sizes.sm, fontWeight: typography.weights.medium }}>
            Slowest: {slowest}
          </div>
        ) : null}

        {detail.governance !== undefined ? (
          <GovernanceSection governance={detail.governance} scope={scope} />
        ) : null}

        <Stack gap={1}>
          <div style={{ fontSize: typography.sizes.xs, color: 'var(--nexora-textMuted)' }}>
            Model
          </div>
          <div style={{ fontSize: typography.sizes.sm }}>
            {modelLabel(run)}
            {run.modelExecution !== undefined
              ? ` · ${run.modelExecution === 'unknown' ? 'local/cloud unknown' : run.modelExecution}`
              : ''}
          </div>
          <div style={{ fontSize: typography.sizes.xs, color: 'var(--nexora-textSecondary)' }}>
            {usageLabel({
              available: run.tokenUsage.available,
              total: run.tokenUsage.totalTokens,
              prompt: run.tokenUsage.promptTokens,
              completion: run.tokenUsage.completionTokens,
            })}{' '}
            · {costLabel(run.cost.estimated, run.cost.currency)}
          </div>
          {/* The run-level line above already describes a single model call. */}
          {run.models.length > 1
            ? run.models.map((model) => <ModelSummary key={model.callId} model={model} />)
            : null}
        </Stack>

        <Stack gap={2}>
          <div style={{ fontSize: typography.sizes.xs, color: 'var(--nexora-textMuted)' }}>
            Timeline
          </div>
          <ol style={{ listStyle: 'none', padding: 0, margin: 0 }}>
            {timeline.map((entry) => (
              <li
                key={entry.stage}
                style={{
                  padding: '8px 0',
                  borderBottom: '1px solid var(--nexora-border)',
                }}
              >
                <Stack direction="row" gap={2} align="center" justify="space-between">
                  <span style={{ fontWeight: typography.weights.medium }}>{entry.stage}</span>
                  <span style={{ fontSize: typography.sizes.xs }}>
                    {formatMs(entry.durationMs)} · {entry.count}×{' '}
                    <Badge tone={entry.status === 'failed' ? 'danger' : 'success'}>
                      {entry.status}
                    </Badge>
                  </span>
                </Stack>
                {entry.items.map((item, index) => {
                  const facts = safeFacts(entry.stage, item);
                  return (
                    <div
                      key={index}
                      style={{
                        marginTop: 4,
                        fontSize: typography.sizes.xs,
                        fontFamily: typography.fontMono,
                        color: 'var(--nexora-textMuted)',
                      }}
                    >
                      {facts.map(([label, value]) => `${label}: ${value}`).join(' · ')}
                    </div>
                  );
                })}
              </li>
            ))}
          </ol>
        </Stack>
      </Stack>
    </Card>
  );
}
