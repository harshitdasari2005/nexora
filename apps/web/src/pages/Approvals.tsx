/**
 * @nexora/app-web — Approvals page.
 *
 * Pending approvals the caller may act on. `canDecide` / `denyReason` are
 * computed by the SERVER; the buttons are shown regardless and the decision
 * route (`POST /api/ai/approvals/:id/decision`, body only `{decision,
 * reason?}`) re-checks authority. 403/409/410 messages are displayed as-is.
 */

import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  Skeleton,
  Stack,
  typography,
} from '@nexora/design-system';

import { AppShell } from '../components/AppShell.js';
import { ErrorState } from '../components/ErrorState.js';
import { LoadingScreen } from '../components/LoadingScreen.js';
import { api, ApiError } from '../lib/api.js';
import { decideApproval } from '../lib/chat.js';
import { listPendingApprovals, relativeTo } from '../lib/policy.js';
import type { ApprovalGovernanceDto, DashboardResponse } from '../lib/types.js';
import { useSession } from '../session.js';
import { NavIcon } from '../components/NavIcon.js';

const toError = (error: unknown): ApiError =>
  error instanceof ApiError ? error : new ApiError(0, 'INTERNAL_ERROR', 'Request failed');

const formatWhen = (iso: string): string =>
  new Date(iso).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });

/** The Approvals application page. */
export function Approvals(): JSX.Element {
  const { data: session } = useSession();
  const [searchParams] = useSearchParams();

  const [dashboard, setDashboard] = useState<DashboardResponse | null>(null);
  const [dashboardError, setDashboardError] = useState<ApiError | null>(null);
  const [approvals, setApprovals] = useState<ApprovalGovernanceDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<ApiError | null>(null);
  const [decidingId, setDecidingId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

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

  const load = useCallback(async () => {
    if (organizationId === undefined || workspaceId === undefined) return;
    setLoading(true);
    setError(null);
    try {
      setApprovals(await listPendingApprovals({ organizationId, workspaceId }));
    } catch (caught) {
      setError(toError(caught));
    } finally {
      setLoading(false);
    }
  }, [organizationId, workspaceId]);

  useEffect(() => {
    void load();
  }, [load]);

  const decide = useCallback(
    async (id: string, decision: 'approve' | 'reject') => {
      setDecidingId(id);
      setActionError(null);
      let failure: Error | null = null;
      try {
        await decideApproval(id, decision, {
          onError: (caught) => {
            failure = caught;
          },
        });
      } catch (caught) {
        failure = caught instanceof Error ? caught : new Error('Request failed');
      }
      if (failure !== null) {
        const err = failure as Error & { status?: number };
        setActionError(
          `${err.status !== undefined && err.status > 0 ? `${err.status} ` : ''}${err.message}`,
        );
      }
      setDecidingId(null);
      await load();
    },
    [load],
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
            icon={<NavIcon name="approvals" size={18} />}
            title="Create a workspace first"
            description="Approvals are scoped to a workspace. Set one up to get started."
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
      <ApprovalsView
        organizationName={dashboard.organization.name}
        workspaceName={dashboard.workspace.name}
        approvals={approvals}
        loading={loading}
        error={error?.message ?? null}
        decidingId={decidingId}
        actionError={actionError}
        onDecide={(id, decision) => void decide(id, decision)}
        onRefresh={() => void load()}
      />
    </AppShell>
  );
}

/** Props of {@link ApprovalsView}. */
export interface ApprovalsViewProps {
  organizationName: string;
  workspaceName: string;
  approvals: readonly ApprovalGovernanceDto[];
  loading: boolean;
  error: string | null;
  decidingId: string | null;
  /** The server's 403/409/410 text for the last decision. */
  actionError: string | null;
  onDecide: (id: string, decision: 'approve' | 'reject') => void;
  onRefresh: () => void;
  /** Injectable clock for the relative expiry (tests). */
  now?: number;
}

/** The pure Approvals content (exported for tests). */
export function ApprovalsView({
  organizationName,
  workspaceName,
  approvals,
  loading,
  error,
  decidingId,
  actionError,
  onDecide,
  onRefresh,
  now,
}: ApprovalsViewProps): JSX.Element {
  return (
    <Stack gap={6} style={{ maxWidth: 1200, margin: '0 auto' }}>
      <Stack
        direction="row"
        gap={4}
        align="center"
        justify="space-between"
        style={{ flexWrap: 'wrap' }}
      >
        <Stack gap={1}>
          <h1 className="nexora-page-title">Approvals</h1>
          <p style={{ fontSize: typography.sizes.sm, color: 'var(--nexora-textSecondary)' }}>
            {organizationName} · {workspaceName} — pending decisions and who may make them
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

      {actionError !== null ? (
        <div
          role="alert"
          style={{
            padding: '10px 14px',
            background: 'var(--nexora-dangerSoft)',
            border: '1px solid var(--nexora-danger)',
            borderRadius: 8,
            fontSize: typography.sizes.sm,
            color: 'var(--nexora-danger)',
          }}
        >
          {actionError}
        </div>
      ) : null}

      {error !== null ? (
        <Card>
          <ErrorState message={error} onRetry={onRefresh} />
        </Card>
      ) : loading && approvals.length === 0 ? (
        <Card>
          <Stack gap={3}>
            <Skeleton height={18} />
            <Skeleton height={18} />
          </Stack>
        </Card>
      ) : approvals.length === 0 ? (
        <Card>
          <EmptyState
            icon={<NavIcon name="approvals" size={18} />}
            title="No pending approvals"
            description="Nothing is waiting for a decision."
          />
        </Card>
      ) : (
        <Stack gap={3}>
          {approvals.map((approval) => (
            <Card key={approval.id} style={{ padding: '14px 16px' }}>
              <Stack gap={3}>
                <Stack
                  direction="row"
                  gap={2}
                  align="center"
                  justify="space-between"
                  style={{ flexWrap: 'wrap' }}
                >
                  <div>
                    <div style={{ fontWeight: typography.weights.semibold }}>
                      {approval.capabilityId}
                    </div>
                    <div
                      style={{
                        fontSize: typography.sizes.xs,
                        fontFamily: typography.fontMono,
                        color: 'var(--nexora-textMuted)',
                      }}
                    >
                      {approval.id}
                    </div>
                  </div>
                  <Stack direction="row" gap={2} align="center">
                    <Badge tone="warning">{approval.status}</Badge>
                    {approval.separationOfDuties ? (
                      <Badge tone="primary">Separation of duties</Badge>
                    ) : null}
                  </Stack>
                </Stack>

                <dl
                  style={{
                    margin: 0,
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
                    gap: 10,
                    fontSize: typography.sizes.sm,
                  }}
                >
                  <Fact label="Requester" value={approval.requesterName ?? approval.requesterId} />
                  <Fact label="Reason" value={approval.reason} />
                  <Fact
                    label="Required approver role"
                    value={
                      approval.requiredApproverRoleId ??
                      (approval.separationOfDuties
                        ? 'Anyone with approval authority except the requester'
                        : 'The requester')
                    }
                  />
                  <Fact
                    label="Expires"
                    value={`${relativeTo(approval.expiresAt, now)} (${formatWhen(approval.expiresAt)})`}
                  />
                  <Fact
                    label="Policy"
                    value={
                      approval.policy !== undefined
                        ? `${approval.policy.policyId} v${approval.policy.version} · ${approval.policy.outcome}`
                        : '—'
                    }
                  />
                </dl>

                <Stack direction="row" gap={2} align="center" style={{ flexWrap: 'wrap' }}>
                  <Button
                    size="sm"
                    onClick={() => onDecide(approval.id, 'approve')}
                    disabled={decidingId !== null}
                    loading={decidingId === approval.id}
                  >
                    Approve
                  </Button>
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => onDecide(approval.id, 'reject')}
                    disabled={decidingId !== null}
                  >
                    Reject
                  </Button>
                  {!approval.canDecide ? (
                    <span
                      style={{ fontSize: typography.sizes.xs, color: 'var(--nexora-textMuted)' }}
                    >
                      You cannot decide this approval
                      {approval.denyReason !== undefined ? `: ${approval.denyReason}` : ''}
                    </span>
                  ) : null}
                </Stack>
              </Stack>
            </Card>
          ))}
        </Stack>
      )}
    </Stack>
  );
}

function Fact({ label, value }: { label: string; value: string }): JSX.Element {
  return (
    <div>
      <dt style={{ fontSize: typography.sizes.xs, color: 'var(--nexora-textMuted)' }}>{label}</dt>
      <dd style={{ margin: 0, overflowWrap: 'anywhere' }}>{value}</dd>
    </div>
  );
}
