/**
 * @nexora/app-web — Audit Center page.
 *
 * A unified, chronological view of consequential activity across Nexora —
 * agent executions, approval decisions, workflow step outcomes, and
 * business activity — through the SAME REST surface RBAC gates like every
 * other resource (`GET /api/audit/events`, `audit.read`). Only a role
 * holding that capability reaches this page at all: today that's the CEO
 * and the Legal workspace's roles (General Counsel, Compliance Manager) —
 * the sidebar hides "Audit" for every other role, and this page's own
 * fetch fails closed with a 403 the same way every other RBAC'd page does.
 *
 * Every field rendered here comes directly from the backend's unified
 * `AuditEventDto` — nothing is fabricated. Fields the underlying journal
 * doesn't have (e.g. `roleName` outside agent-execution events) are simply
 * absent, shown as "—", never guessed.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  Input,
  Select,
  Skeleton,
  Stack,
  typography,
} from '@nexora/design-system';

import { AppShell } from '../components/AppShell.js';
import { ErrorState } from '../components/ErrorState.js';
import { LoadingScreen } from '../components/LoadingScreen.js';
import { api, ApiError } from '../lib/api.js';
import type { AuditEventDto, AuditEventSource, DashboardResponse } from '../lib/types.js';
import { useSession } from '../session.js';

/** The Audit Center application page. */
export function Audit(): JSX.Element {
  const { data: session } = useSession();
  const [searchParams] = useSearchParams();

  const [state, setState] = useState<{
    dashboard: DashboardResponse | null;
    events: AuditEventDto[];
    loading: boolean;
    error: ApiError | null;
  }>({ dashboard: null, events: [], loading: true, error: null });

  const load = useCallback(async () => {
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
        setState({ dashboard, events: [], loading: false, error: null });
        return;
      }
      const listed = await api<{ events: AuditEventDto[] }>(
        `/audit/events?organizationId=${encodeURIComponent(dashboard.organization.id)}&workspaceId=${encodeURIComponent(dashboard.workspace.id)}`,
      );
      setState({ dashboard, events: listed.events, loading: false, error: null });
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
            icon="🛡"
            title="Create a workspace first"
            description="The audit trail is scoped to a workspace. Set one up to get started."
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
      <AuditView
        organizationName={dashboard.organization.name}
        workspaceName={dashboard.workspace.name}
        events={state.events}
        loading={state.loading}
        onRefresh={() => void load()}
      />
    </AppShell>
  );
}

const SOURCE_LABELS: Record<AuditEventSource, string> = {
  agent_execution: 'Agent run',
  approval: 'Approval',
  workflow_step: 'Workflow step',
  activity: 'Activity',
};

const SOURCE_TONES: Record<AuditEventSource, 'ai' | 'warning' | 'primary' | 'neutral'> = {
  agent_execution: 'ai',
  approval: 'warning',
  workflow_step: 'primary',
  activity: 'neutral',
};

const SUCCESS_STATUSES = new Set(['completed', 'succeeded', 'granted', 'approved', 'recorded']);
const DANGER_STATUSES = new Set(['failed', 'rejected', 'blocked']);
const WARNING_STATUSES = new Set([
  'awaiting_approval',
  'pending',
  'executing',
  'running',
  'proposed',
]);

/** Maps a raw status value to a badge tone (never invents a status — just colors the real one). */
function statusTone(status: string): 'success' | 'danger' | 'warning' | 'neutral' {
  if (SUCCESS_STATUSES.has(status)) return 'success';
  if (DANGER_STATUSES.has(status)) return 'danger';
  if (WARNING_STATUSES.has(status)) return 'warning';
  return 'neutral';
}

/** Formats an ISO timestamp for the chronological list. */
function formatWhen(iso: string): string {
  return new Date(iso).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

/** Formats an ISO timestamp with full precision for the detail panel. */
function formatWhenFull(iso: string): string {
  return new Date(iso).toLocaleString('en-US', {
    weekday: 'short',
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit',
  });
}

/** Props of {@link AuditView}. */
export interface AuditViewProps {
  organizationName: string;
  workspaceName: string;
  events: readonly AuditEventDto[];
  loading: boolean;
  onRefresh: () => void;
}

/** The pure Audit Center content (exported for smoke tests). */
export function AuditView({
  organizationName,
  workspaceName,
  events,
  loading,
  onRefresh,
}: AuditViewProps): JSX.Element {
  const [sourceFilter, setSourceFilter] = useState<AuditEventSource | 'all'>('all');
  const [approvalOnly, setApprovalOnly] = useState(false);
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const summary = useMemo(() => {
    const bySource: Record<AuditEventSource, number> = {
      agent_execution: 0,
      approval: 0,
      workflow_step: 0,
      activity: 0,
    };
    let approvalRequired = 0;
    for (const event of events) {
      bySource[event.source] += 1;
      if (event.approvalRequired) approvalRequired += 1;
    }
    return { total: events.length, bySource, approvalRequired };
  }, [events]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return events.filter((event) => {
      if (sourceFilter !== 'all' && event.source !== sourceFilter) return false;
      if (approvalOnly && !event.approvalRequired) return false;
      if (needle.length > 0) {
        const haystack = [
          event.action,
          event.object,
          event.detail,
          event.actorName,
          event.module,
          event.roleName,
        ]
          .filter((value): value is string => value !== undefined)
          .join(' \n ')
          .toLowerCase();
        if (!haystack.includes(needle)) return false;
      }
      return true;
    });
  }, [events, sourceFilter, approvalOnly, query]);

  const selected = filtered.find((event) => event.id === selectedId) ?? null;

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
          <h1 style={{ fontSize: typography.sizes['2xl'], fontWeight: typography.weights.bold }}>
            Audit Center
          </h1>
          <p style={{ fontSize: typography.sizes.sm, color: 'var(--nexora-textSecondary)' }}>
            {organizationName} · {workspaceName} — a unified record of consequential activity
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

      {/* Summary */}
      <div className="nexora-audit-summary">
        <SummaryCard label="Total events" value={summary.total} />
        <SummaryCard label="Agent runs" value={summary.bySource.agent_execution} tone="ai" />
        <SummaryCard label="Approvals" value={summary.bySource.approval} tone="warning" />
        <SummaryCard label="Workflow steps" value={summary.bySource.workflow_step} tone="primary" />
        <SummaryCard label="Activity" value={summary.bySource.activity} />
        <SummaryCard label="Required approval" value={summary.approvalRequired} />
      </div>

      {/* Filters */}
      <Card style={{ padding: '14px 16px' }}>
        <Stack direction="row" gap={3} align="center" style={{ flexWrap: 'wrap' }}>
          <div style={{ minWidth: 180 }}>
            <Select
              aria-label="Filter by source"
              value={sourceFilter}
              onChange={(event) =>
                setSourceFilter(event.currentTarget.value as AuditEventSource | 'all')
              }
            >
              <option value="all">All sources</option>
              <option value="agent_execution">Agent runs</option>
              <option value="approval">Approvals</option>
              <option value="workflow_step">Workflow steps</option>
              <option value="activity">Activity</option>
            </Select>
          </div>
          <div style={{ flex: '1 1 240px', minWidth: 200 }}>
            <Input
              aria-label="Search audit events"
              placeholder="Search by actor, action, module…"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </div>
          <label
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              fontSize: typography.sizes.sm,
              color: 'var(--nexora-textSecondary)',
              cursor: 'pointer',
              whiteSpace: 'nowrap',
            }}
          >
            <input
              type="checkbox"
              checked={approvalOnly}
              onChange={(event) => setApprovalOnly(event.currentTarget.checked)}
            />
            Required approval only
          </label>
          <span style={{ fontSize: typography.sizes.xs, color: 'var(--nexora-textMuted)' }}>
            {filtered.length} of {events.length} events
          </span>
        </Stack>
      </Card>

      <div className="nexora-audit-layout">
        <div className="nexora-audit-main">
          {loading ? (
            <Card>
              <Stack gap={3}>
                <Skeleton height={18} />
                <Skeleton height={18} />
                <Skeleton height={18} />
              </Stack>
            </Card>
          ) : filtered.length === 0 ? (
            <Card>
              <EmptyState
                icon="🛡"
                title="No audit events"
                description="Nothing matches the current filters yet."
              />
            </Card>
          ) : (
            <>
              <div className="nexora-audit-table-wrap">
                <table className="nexora-audit-table">
                  <thead>
                    <tr>
                      <th>Time</th>
                      <th>Actor</th>
                      <th className="nexora-audit-col-secondary">Role</th>
                      <th>Module</th>
                      <th>Action</th>
                      <th className="nexora-audit-col-secondary">Object</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map((event) => (
                      <tr
                        key={event.id}
                        className={
                          event.id === selectedId ? 'nexora-audit-row-selected' : undefined
                        }
                        onClick={() => setSelectedId(event.id)}
                      >
                        <td>{formatWhen(event.occurredAt)}</td>
                        <td>{event.actorName}</td>
                        <td className="nexora-audit-col-secondary">{event.roleName ?? '—'}</td>
                        <td>{event.module}</td>
                        <td className="nexora-audit-cell-action">{event.action}</td>
                        <td className="nexora-audit-col-secondary">{event.object ?? '—'}</td>
                        <td>
                          <Badge tone={statusTone(event.status)}>{event.statusLabel}</Badge>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="nexora-audit-cards">
                {filtered.map((event) => (
                  <button
                    key={event.id}
                    type="button"
                    className={
                      event.id === selectedId
                        ? 'nexora-audit-card nexora-audit-card-selected'
                        : 'nexora-audit-card'
                    }
                    onClick={() => setSelectedId(event.id)}
                  >
                    <Card style={{ padding: '12px 14px', textAlign: 'left' }}>
                      <Stack gap={1.5}>
                        <Stack direction="row" gap={2} align="center" justify="space-between">
                          <Badge tone={SOURCE_TONES[event.source]}>
                            {SOURCE_LABELS[event.source]}
                          </Badge>
                          <Badge tone={statusTone(event.status)}>{event.statusLabel}</Badge>
                        </Stack>
                        <div style={{ fontWeight: typography.weights.medium }}>{event.action}</div>
                        <div
                          style={{
                            fontSize: typography.sizes.xs,
                            color: 'var(--nexora-textMuted)',
                          }}
                        >
                          {event.actorName} · {formatWhen(event.occurredAt)}
                        </div>
                      </Stack>
                    </Card>
                  </button>
                ))}
              </div>
            </>
          )}
        </div>

        <div className="nexora-audit-detail">
          {selected === null ? (
            <Card>
              <EmptyState
                icon="🛡"
                title="Select an event"
                description="Choose a row to see its full detail."
              />
            </Card>
          ) : (
            <EventDetail event={selected} />
          )}
        </div>
      </div>

      <style>{`
        .nexora-audit-summary {
          display: grid;
          grid-template-columns: repeat(6, minmax(0, 1fr));
          gap: 12px;
        }
        .nexora-audit-layout {
          display: grid;
          grid-template-columns: minmax(0, 1fr) 340px;
          gap: 20px;
          align-items: start;
        }
        /* The table scrolls horizontally within its own card at narrower
           widths (a min-width keeps every column legible) rather than
           clipping or illegibly squeezing content — a standard pattern for
           dense data tables, distinct from a squeezed visual layout. Role
           and Object drop out of the table below 1024px (they stay fully
           visible in the detail panel) purely to reduce how often that
           scroll is needed, not to hide information. */
        .nexora-audit-table-wrap { overflow-x: auto; }
        .nexora-audit-table {
          width: 100%;
          min-width: 720px;
          border-collapse: collapse;
          font-size: ${typography.sizes.sm};
        }
        .nexora-audit-table thead th {
          text-align: left;
          padding: 10px 12px;
          font-size: ${typography.sizes.xs};
          font-weight: ${typography.weights.medium};
          color: var(--nexora-textMuted);
          border-bottom: 1px solid var(--nexora-border);
          white-space: nowrap;
        }
        .nexora-audit-table tbody td {
          padding: 10px 12px;
          border-bottom: 1px solid var(--nexora-border);
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
          max-width: 220px;
        }
        .nexora-audit-table tbody td.nexora-audit-cell-action { white-space: normal; max-width: 320px; }
        .nexora-audit-table tbody tr { cursor: pointer; background: var(--nexora-surface); }
        .nexora-audit-table tbody tr:hover { background: var(--nexora-surfaceMuted); }
        .nexora-audit-row-selected td { background: var(--nexora-primarySoft); }
        .nexora-audit-cards { display: none; flex-direction: column; gap: 10px; }
        .nexora-audit-card { border: none; background: transparent; padding: 0; cursor: pointer; text-align: left; width: 100%; }
        .nexora-audit-card-selected > div { border-color: var(--nexora-primary); }
        @media (max-width: 1024px) {
          .nexora-audit-summary { grid-template-columns: repeat(3, minmax(0, 1fr)); }
          .nexora-audit-layout { grid-template-columns: minmax(0, 1fr) 300px; }
          .nexora-audit-col-secondary { display: none; }
          .nexora-audit-table { min-width: 560px; }
        }
        @media (max-width: 768px) {
          .nexora-audit-layout { grid-template-columns: minmax(0, 1fr); }
        }
        @media (max-width: 640px) {
          .nexora-audit-summary { grid-template-columns: repeat(2, minmax(0, 1fr)); }
          .nexora-audit-table-wrap { display: none; }
          .nexora-audit-cards { display: flex; }
        }
      `}</style>
    </Stack>
  );
}

/** One summary count card (the header KPI row). */
function SummaryCard({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone?: 'ai' | 'warning' | 'primary';
}): JSX.Element {
  return (
    <Card style={{ padding: '12px 14px' }}>
      <Stack gap={1}>
        <div
          style={{
            fontSize: typography.sizes['2xl'],
            fontWeight: typography.weights.bold,
            color: tone !== undefined ? `var(--nexora-${tone})` : 'var(--nexora-text)',
          }}
        >
          {value}
        </div>
        <div style={{ fontSize: typography.sizes.xs, color: 'var(--nexora-textMuted)' }}>
          {label}
        </div>
      </Stack>
    </Card>
  );
}

/** The full detail view of one selected audit event. */
export function EventDetail({ event }: { event: AuditEventDto }): JSX.Element {
  return (
    <Card>
      <Stack gap={4}>
        <Stack gap={1}>
          <Stack direction="row" gap={2} align="center">
            <Badge tone={SOURCE_TONES[event.source]}>{SOURCE_LABELS[event.source]}</Badge>
            <Badge tone={statusTone(event.status)}>{event.statusLabel}</Badge>
          </Stack>
          <div style={{ fontWeight: typography.weights.semibold, fontSize: typography.sizes.md }}>
            {event.action}
          </div>
        </Stack>

        <DetailRow label="Actor" value={event.actorName} />
        {event.roleName !== undefined ? <DetailRow label="Role" value={event.roleName} /> : null}
        <DetailRow label="Module" value={event.module} />
        {event.object !== undefined ? <DetailRow label="Object" value={event.object} /> : null}
        <DetailRow label="Timestamp" value={formatWhenFull(event.occurredAt)} />
        {event.workspaceName !== undefined ? (
          <DetailRow label="Workspace" value={event.workspaceName} />
        ) : null}
        <DetailRow label="Approval required" value={event.approvalRequired ? 'Yes' : 'No'} />

        {event.approvalOutcome !== undefined ? (
          <Stack gap={1.5}>
            <div
              style={{
                fontSize: typography.sizes.xs,
                fontWeight: typography.weights.medium,
                color: 'var(--nexora-textMuted)',
              }}
            >
              Approval outcome
            </div>
            <Stack
              gap={1}
              style={{
                padding: '10px 12px',
                background: 'var(--nexora-surfaceMuted)',
                borderRadius: 8,
              }}
            >
              <DetailRow label="Status" value={event.approvalOutcome.statusLabel} compact />
              {event.approvalOutcome.decidedByName !== undefined ? (
                <DetailRow label="Decided by" value={event.approvalOutcome.decidedByName} compact />
              ) : null}
              {event.approvalOutcome.decisionReason !== undefined ? (
                <DetailRow label="Reason" value={event.approvalOutcome.decisionReason} compact />
              ) : null}
            </Stack>
          </Stack>
        ) : null}

        {event.detail !== undefined ? (
          <Stack gap={1}>
            <div
              style={{
                fontSize: typography.sizes.xs,
                fontWeight: typography.weights.medium,
                color: 'var(--nexora-textMuted)',
              }}
            >
              Detail
            </div>
            <p
              style={{
                fontSize: typography.sizes.sm,
                color: 'var(--nexora-textSecondary)',
                whiteSpace: 'pre-wrap',
              }}
            >
              {event.detail}
            </p>
          </Stack>
        ) : null}

        {event.error !== undefined ? (
          <Stack gap={1}>
            <div
              style={{
                fontSize: typography.sizes.xs,
                fontWeight: typography.weights.medium,
                color: 'var(--nexora-danger)',
              }}
            >
              Error
            </div>
            <p style={{ fontSize: typography.sizes.sm, color: 'var(--nexora-danger)' }}>
              {event.error}
            </p>
          </Stack>
        ) : null}

        {event.references !== undefined && Object.keys(event.references).length > 0 ? (
          <Stack gap={1.5}>
            <div
              style={{
                fontSize: typography.sizes.xs,
                fontWeight: typography.weights.medium,
                color: 'var(--nexora-textMuted)',
              }}
            >
              References
            </div>
            <Stack gap={1}>
              {Object.entries(event.references)
                .filter(([, value]) => value.length > 0)
                .map(([key, value]) => (
                  <div
                    key={key}
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      gap: 8,
                      fontSize: typography.sizes.xs,
                      fontFamily: typography.fontMono,
                      color: 'var(--nexora-textMuted)',
                    }}
                  >
                    <span>{key}</span>
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{value}</span>
                  </div>
                ))}
            </Stack>
          </Stack>
        ) : null}
      </Stack>
    </Card>
  );
}

/** One label/value row in the detail panel. */
function DetailRow({
  label,
  value,
  compact = false,
}: {
  label: string;
  value: string;
  compact?: boolean;
}): JSX.Element {
  return (
    <Stack direction="row" gap={3} justify="space-between" align="flex-start">
      <span
        style={{
          fontSize: compact ? typography.sizes.xs : typography.sizes.sm,
          color: 'var(--nexora-textMuted)',
          flexShrink: 0,
        }}
      >
        {label}
      </span>
      <span
        style={{
          fontSize: compact ? typography.sizes.xs : typography.sizes.sm,
          color: 'var(--nexora-text)',
          textAlign: 'right',
        }}
      >
        {value}
      </span>
    </Stack>
  );
}
