/**
 * @nexora/app-web — Workflows page.
 *
 * The read-only workflow execution view (workflow vertical slice; FRONTEND.md
 * §7): lists the workflows of the current organization and shows a step
 * timeline for the selected one — status, current step, completed steps,
 * failures, and the final result. Deliberately minimal: no workflow designer.
 */

import { useCallback, useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
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
  CompositeApprovalDto,
  DashboardResponse,
  WorkflowExecutionRecordDto,
  WorkflowInstanceDto,
  WorkflowStateKey,
  WorkflowStepExecutionDto,
} from '../lib/types.js';
import { resolveWorkflowState, stateStyle } from '../lib/workflowState.js';
import { useSession } from '../session.js';

/** The workflow execution view. */
export function Workflows(): JSX.Element {
  const { data: session } = useSession();
  const [searchParams] = useSearchParams();

  const [state, setState] = useState<{
    dashboard: DashboardResponse | null;
    workflows: WorkflowInstanceDto[];
    composites: CompositeApprovalDto[];
    loading: boolean;
    error: ApiError | null;
  }>({ dashboard: null, workflows: [], composites: [], loading: true, error: null });

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
        setState({ dashboard, workflows: [], composites: [], loading: false, error: null });
        return;
      }
      const listed = await api<{
        workflows: WorkflowInstanceDto[];
        composites?: CompositeApprovalDto[];
      }>(`/workflows?organizationId=${encodeURIComponent(dashboard.organization.id)}`);
      setState({
        dashboard,
        workflows: listed.workflows,
        composites: listed.composites ?? [],
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
        initialComposites={state.composites}
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
  /** Composite unit approvals with no workflow instance (waiting / rejected / expired / refused). */
  initialComposites?: readonly CompositeApprovalDto[];
}

/** The pure workflows content (exported for smoke tests). */
export function WorkflowsView({
  organizationId,
  organizationName,
  initialWorkflows,
  initialComposites = [],
}: WorkflowsViewProps): JSX.Element {
  const [workflows, setWorkflows] = useState<WorkflowInstanceDto[]>(() => [...initialWorkflows]);
  const [composites, setComposites] = useState<CompositeApprovalDto[]>(() => [
    ...initialComposites,
  ]);
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
      const listed = await api<{
        workflows: WorkflowInstanceDto[];
        composites?: CompositeApprovalDto[];
      }>(`/workflows?organizationId=${encodeURIComponent(organizationId)}`);
      setWorkflows(listed.workflows);
      setComposites(listed.composites ?? []);
    } catch {
      // Keep the mounted list intact on a background refresh failure.
    }
  }, [organizationId]);

  return (
    <Stack gap={8} style={{ maxWidth: 880, margin: '0 auto' }}>
      <Stack direction="row" gap={4} align="center" justify="space-between">
        <Stack gap={1}>
          <h1 className="nexora-page-title">Workflows</h1>
          <p style={{ fontSize: typography.sizes.sm, color: 'var(--nexora-textSecondary)' }}>
            {organizationName} — execution timeline
          </p>
        </Stack>
        <Button size="sm" variant="secondary" onClick={() => void refresh()}>
          Refresh
        </Button>
      </Stack>

      {composites.length > 0 ? (
        <Stack gap={3}>
          {composites.map((composite) => (
            <CompositeApprovalRow key={composite.approvalId} composite={composite} />
          ))}
        </Stack>
      ) : null}

      {workflows.length === 0 && composites.length === 0 ? (
        <Card>
          <EmptyState
            icon="⧉"
            title="No workflows yet"
            description="Ask the AI: “Create a project called Mobile Banking and assign Priya to it.” The workflow will appear here."
          />
        </Card>
      ) : workflows.length === 0 ? null : (
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
            <StepTimeline steps={detail.steps} instance={detail.instance} />
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
              maxWidth: 520,
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
            {workflow.stateDetail !== undefined ? ` — ${workflow.stateDetail}` : ''}
          </div>
        </Stack>
        <Stack direction="row" gap={3} align="center" style={{ flexShrink: 0 }}>
          <WorkflowStatusBadge instance={workflow} />
          <Button size="sm" variant={selected ? 'primary' : 'secondary'} onClick={onOpen}>
            {selected ? 'Viewing' : 'View'}
          </Button>
        </Stack>
      </Stack>
    </Card>
  );
}

/** A composite waiting for / refused at its unit approval: no instance exists. */
export function CompositeApprovalRow({
  composite,
}: {
  composite: CompositeApprovalDto;
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
          <div style={{ fontWeight: typography.weights.semibold }} title={composite.capabilityId}>
            {humanizeIdentifier(composite.definitionKey ?? composite.capabilityId)}
          </div>
          <div style={{ fontSize: typography.sizes.xs, color: 'var(--nexora-textMuted)' }}>
            {composite.stateDetail}
          </div>
        </Stack>
        <Stack direction="row" gap={3} align="center" style={{ flexShrink: 0 }}>
          <WorkflowStateBadge state={composite.state} />
          {composite.state === 'waiting_for_approval' ? (
            <Link to="/app/approvals" style={{ fontSize: typography.sizes.sm }}>
              Open approvals
            </Link>
          ) : null}
        </Stack>
      </Stack>
    </Card>
  );
}

const STEP_VERIFICATION_TEXT: Readonly<Record<string, string>> = {
  verified: 'verified by state read-back',
  self_reported: 'self-reported by the tool — no independent read-back',
  unverified: 'verification did not pass',
  missing: 'no verification record found',
};

/** The read-only step timeline of a workflow execution. */
export function StepTimeline({
  steps,
  instance,
}: {
  steps: readonly WorkflowStepExecutionDto[];
  instance: WorkflowInstanceDto;
}): JSX.Element {
  const state = resolveWorkflowState(instance);
  const style = stateStyle(state);
  const detail =
    instance.stateDetail ??
    (state === 'completed_unverified' ? 'Completed — not independently verified.' : style.label);
  return (
    <Stack gap={2}>
      {steps.map((step) => {
        const compensation = step.purpose === 'compensation';
        const verification = step.verification;
        const verificationText =
          verification !== undefined && verification.status !== 'not_applicable'
            ? STEP_VERIFICATION_TEXT[verification.status]
            : undefined;
        return (
          <div key={step.id} style={{ display: 'flex', gap: 10 }}>
            <span aria-hidden style={{ width: 20, textAlign: 'center', flexShrink: 0 }}>
              {compensation
                ? '↺'
                : step.status === 'succeeded'
                  ? '✓'
                  : step.status === 'failed'
                    ? '✕'
                    : '…'}
            </span>
            <Stack gap={0} style={{ minWidth: 0 }}>
              <div style={{ fontSize: typography.sizes.sm, fontWeight: typography.weights.medium }}>
                {step.name}
                {compensation ? ' (rollback)' : ''}
              </div>
              <div
                style={{ fontSize: typography.sizes.xs, color: 'var(--nexora-textMuted)' }}
                title={step.capabilityId}
              >
                {humanizeIdentifier(step.capabilityId)}
                {` · ${step.status}`}
                {step.attempt > 1 ? ` · attempt ${step.attempt}` : ''}
                {step.errorCode !== undefined ? ` · ${step.errorCode}` : ''}
                {step.error !== undefined ? ` · ${step.error}` : ''}
                {verificationText !== undefined ? ` · ${verificationText}` : ''}
              </div>
            </Stack>
          </div>
        );
      })}
      <div
        role="status"
        data-workflow-state={state}
        style={{
          marginTop: 4,
          fontSize: typography.sizes.xs,
          fontWeight: typography.weights.medium,
          // Green ONLY for a verified success; everything else is never green.
          color:
            style.tone === 'success'
              ? 'var(--nexora-success)'
              : style.tone === 'warning'
                ? 'var(--nexora-warning)'
                : style.tone === 'danger'
                  ? 'var(--nexora-danger)'
                  : 'var(--nexora-textSecondary)',
        }}
      >
        <span aria-hidden>{style.icon} </span>
        {style.label}. {detail}
      </div>
      {instance.approvalId !== undefined || instance.initiator !== undefined ? (
        <div style={{ fontSize: typography.sizes.xs, color: 'var(--nexora-textMuted)' }}>
          {instance.initiator !== undefined ? `Initiated by ${instance.initiator}` : ''}
          {instance.approvalId !== undefined ? ` · approval ${instance.approvalId}` : ''}
          {instance.errorCode !== undefined ? ` · error ${instance.errorCode}` : ''}
        </div>
      ) : null}
    </Stack>
  );
}

/** A state badge (the only mapping from state to tone). */
export function WorkflowStateBadge({ state }: { state: WorkflowStateKey }): JSX.Element {
  const style = stateStyle(state);
  return (
    <Badge tone={style.tone} dot={state === 'executing' || state === 'verified'}>
      {style.label}
    </Badge>
  );
}

/** Renders the badge of an instance (server state, else a conservative derivation). */
export function WorkflowStatusBadge({
  instance,
}: {
  instance: Pick<WorkflowInstanceDto, 'status' | 'state' | 'compensation'>;
}): JSX.Element {
  return <WorkflowStateBadge state={resolveWorkflowState(instance)} />;
}
