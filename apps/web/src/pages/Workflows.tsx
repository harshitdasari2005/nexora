/**
 * @nexora/app-web — Workflows page.
 *
 * The read-only workflow execution view (workflow vertical slice; FRONTEND.md
 * §7): lists the workflows of the current organization and shows a step
 * timeline for the selected one — status, current step, completed steps,
 * failures, and the final result. Deliberately minimal: no workflow designer.
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
import { humanizeIdentifier } from '../lib/humanize.js';
import type {
  DashboardResponse,
  WorkflowExecutionRecordDto,
  WorkflowInstanceDto,
  WorkflowStepExecutionDto,
} from '../lib/types.js';
import { useSession } from '../session.js';

/** The workflow execution view. */
export function Workflows(): JSX.Element {
  const { data: session } = useSession();
  const [searchParams] = useSearchParams();

  const [state, setState] = useState<{
    dashboard: DashboardResponse | null;
    workflows: WorkflowInstanceDto[];
    loading: boolean;
    error: ApiError | null;
  }>({ dashboard: null, workflows: [], loading: true, error: null });

  const load = useCallback(async () => {
    // Keeps any already-loaded dashboard visible while refetching — a role
    // switch re-runs this exact effect, and resetting to `null` would
    // unmount AppShell (sidebar included) on every switch.
    setState((current) => ({ ...current, loading: true, error: null }));
    try {
      const params = new URLSearchParams();
      const organizationId = searchParams.get('organizationId');
      if (organizationId !== null) params.set('organizationId', organizationId);
      const suffix = params.size > 0 ? `?${params.toString()}` : '';
      const dashboard = await api<DashboardResponse>(`/dashboard${suffix}`);
      if (dashboard.organization === null) {
        setState({ dashboard, workflows: [], loading: false, error: null });
        return;
      }
      const listed = await api<{ workflows: WorkflowInstanceDto[] }>(
        `/workflows?organizationId=${encodeURIComponent(dashboard.organization.id)}`,
      );
      setState({ dashboard, workflows: listed.workflows, loading: false, error: null });
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
  if (dashboard.organization === null) {
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
            icon="⧉"
            title="Create your organization first"
            description="Workflows run inside an organization. Set one up to get started."
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
      workspaceName={dashboard.workspace?.name ?? 'No workspace yet'}
      organizationId={dashboard.organization.id}
      workspaceId={dashboard.workspace?.id}
    >
      <WorkflowsView
        organizationId={dashboard.organization.id}
        organizationName={dashboard.organization.name}
        initialWorkflows={state.workflows}
      />
    </AppShell>
  );
}

/** Props of {@link WorkflowsView}. */
export interface WorkflowsViewProps {
  /** The current organization (tenant) id. */
  organizationId: string;
  /** The current organization name. */
  organizationName: string;
  /** The workflows to render. */
  initialWorkflows: readonly WorkflowInstanceDto[];
}

/** The pure workflows content (exported for smoke tests). */
export function WorkflowsView({
  organizationId,
  organizationName,
  initialWorkflows,
}: WorkflowsViewProps): JSX.Element {
  const [workflows, setWorkflows] = useState<WorkflowInstanceDto[]>(() => [...initialWorkflows]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<WorkflowExecutionRecordDto | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);

  const open = useCallback(
    async (workflowId: string) => {
      setSelectedId(workflowId);
      setDetail(null);
      setLoadingDetail(true);
      setDetailError(null);
      try {
        const record = await api<{ workflow: WorkflowExecutionRecordDto }>(
          `/workflows/${encodeURIComponent(workflowId)}?organizationId=${encodeURIComponent(organizationId)}`,
        );
        setDetail(record.workflow);
      } catch (error) {
        setDetailError(
          error instanceof ApiError ? error.message : 'Could not load the workflow execution.',
        );
      } finally {
        setLoadingDetail(false);
      }
    },
    [organizationId],
  );

  const refresh = useCallback(async () => {
    try {
      const listed = await api<{ workflows: WorkflowInstanceDto[] }>(
        `/workflows?organizationId=${encodeURIComponent(organizationId)}`,
      );
      setWorkflows(listed.workflows);
    } catch {
      // Keep the mounted list intact on a background refresh failure.
    }
  }, [organizationId]);

  return (
    <Stack gap={8} style={{ maxWidth: 880, margin: '0 auto' }}>
      <Stack direction="row" gap={4} align="center" justify="space-between">
        <Stack gap={1}>
          <h1 style={{ fontSize: typography.sizes['3xl'], fontWeight: typography.weights.bold, letterSpacing: '-0.03em', lineHeight: 1.1 }}>
            Workflows
          </h1>
          <p style={{ fontSize: typography.sizes.sm, color: 'var(--nexora-textSecondary)' }}>
            {organizationName} — execution timeline
          </p>
        </Stack>
        <Button size="sm" variant="secondary" onClick={() => void refresh()}>
          Refresh
        </Button>
      </Stack>

      {workflows.length === 0 ? (
        <Card>
          <EmptyState
            icon="⧉"
            title="No workflows yet"
            description="Ask the AI: “Create a project called Mobile Banking and assign Priya to it.” The workflow will appear here."
          />
        </Card>
      ) : (
        <Stack gap={3}>
          {workflows.map((workflow) => (
            <WorkflowRow
              key={workflow.id}
              workflow={workflow}
              selected={workflow.id === selectedId}
              onOpen={() => void open(workflow.id)}
            />
          ))}
        </Stack>
      )}

      {selectedId !== null ? (
        <Card>
          <div style={{ fontWeight: typography.weights.semibold, marginBottom: 12 }}>
            Execution timeline
          </div>
          {loadingDetail ? (
            <Stack gap={2}>
              <Skeleton height={18} />
              <Skeleton height={18} />
              <Skeleton height={18} />
            </Stack>
          ) : detailError !== null ? (
            <div style={{ fontSize: typography.sizes.sm, color: 'var(--nexora-danger)' }}>
              {detailError}
            </div>
          ) : detail !== null ? (
            <StepTimeline steps={detail.steps} status={detail.instance.status} />
          ) : null}
        </Card>
      ) : null}
    </Stack>
  );
}

/** A single workflow row with status display. */
export function WorkflowRow({
  workflow,
  selected,
  onOpen,
}: {
  workflow: WorkflowInstanceDto;
  selected: boolean;
  onOpen: () => void;
}): JSX.Element {
  return (
    <Card style={{ padding: '14px 16px' }}>
      <Stack
        direction="row"
        gap={3}
        align="center"
        justify="space-between"
        style={{ flexWrap: 'wrap' }}
      >
        <Stack gap={0.5} style={{ minWidth: 0 }}>
          <div style={{ fontWeight: typography.weights.semibold }} title={workflow.definitionKey}>
            {humanizeIdentifier(workflow.definitionKey)}
          </div>
          <div
            style={{
              fontSize: typography.sizes.xs,
              color: 'var(--nexora-textMuted)',
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              maxWidth: 480,
            }}
            title={workflow.id}
          >
            Started{' '}
            {new Date(workflow.startedAt).toLocaleString('en-US', {
              month: 'short',
              day: 'numeric',
              hour: 'numeric',
              minute: '2-digit',
            })}
          </div>
        </Stack>
        <Stack direction="row" gap={3} align="center" style={{ flexShrink: 0 }}>
          <WorkflowStatusBadge status={workflow.status} />
          <Button size="sm" variant={selected ? 'primary' : 'secondary'} onClick={onOpen}>
            {selected ? 'Viewing' : 'View'}
          </Button>
        </Stack>
      </Stack>
    </Card>
  );
}

/** The read-only step timeline of a workflow execution. */
export function StepTimeline({
  steps,
  status,
}: {
  steps: readonly WorkflowStepExecutionDto[];
  status: string;
}): JSX.Element {
  const succeeded = status === 'succeeded';
  return (
    <Stack gap={2}>
      {steps.map((step) => (
        <div key={step.id} style={{ display: 'flex', gap: 10 }}>
          <span aria-hidden style={{ width: 20, textAlign: 'center', flexShrink: 0 }}>
            {step.status === 'succeeded' ? '✓' : step.status === 'failed' ? '✕' : '…'}
          </span>
          <Stack gap={0} style={{ minWidth: 0 }}>
            <div style={{ fontSize: typography.sizes.sm, fontWeight: typography.weights.medium }}>
              {step.name}
            </div>
            <div
              style={{ fontSize: typography.sizes.xs, color: 'var(--nexora-textMuted)' }}
              title={step.capabilityId}
            >
              {humanizeIdentifier(step.capabilityId)}
              {step.attempt > 1 ? ` · attempt ${step.attempt}` : ''}
              {step.error !== undefined ? ` · ${step.error}` : ''}
            </div>
          </Stack>
        </div>
      ))}
      {succeeded ? (
        <div style={{ display: 'flex', gap: 10 }}>
          <span aria-hidden style={{ width: 20, textAlign: 'center', flexShrink: 0 }}>
            ✓
          </span>
          <span style={{ fontSize: typography.sizes.sm }}>Verify</span>
        </div>
      ) : null}
      <div
        style={{
          marginTop: 4,
          fontSize: typography.sizes.xs,
          fontWeight: typography.weights.medium,
          color: succeeded ? 'var(--nexora-success)' : 'var(--nexora-danger)',
        }}
      >
        {succeeded
          ? 'Workflow completed.'
          : status === 'failed'
            ? 'Workflow failed — no partial success was reported.'
            : `Workflow ${status.replaceAll('_', ' ')}.`}
      </div>
    </Stack>
  );
}

/** Maps a workflow status to a tone. */
export function WorkflowStatusBadge({ status }: { status: string }): JSX.Element {
  if (status === 'succeeded') {
    return (
      <Badge tone="success" dot>
        Completed
      </Badge>
    );
  }
  if (status === 'failed') {
    return <Badge tone="danger">Failed</Badge>;
  }
  if (status === 'cancelled') {
    // Matches the "Cancelled" tone used everywhere else in the app
    // (projects, employees, remediation plans) — danger, not neutral.
    return <Badge tone="danger">Cancelled</Badge>;
  }
  if (status === 'awaiting_approval') {
    return <Badge tone="warning">Awaiting approval</Badge>;
  }
  if (status === 'running' || status === 'ready' || status === 'planning') {
    return (
      <Badge tone="primary" dot>
        Running
      </Badge>
    );
  }
  return <Badge>Created</Badge>;
}
