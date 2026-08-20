/**
 * @nexora/app-web — Problems console (S27 detection + Phase 10 remediation).
 *
 * The dedicated "what needs attention, and what do we do about it" surface:
 * every detected business problem with its full grounded investigation
 * (evidence, root-cause candidates, known solutions), and — the hero flow —
 * a governed remediation plan: create it, watch each step's rationale and
 * approval requirement, approve, execute, and see the problem re-evaluated
 * and resolved. Every action goes through the EXISTING governed engines
 * (`@nexora/module-detection`, `@nexora/module-remediation`) via the EXISTING
 * approval surface — this page only renders and lets the user act.
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
import {
  ProblemInvestigation,
  SectionLabel,
  severityAccent,
  severityTone,
} from '../components/ProblemInvestigation.js';
import { api, ApiError } from '../lib/api.js';
import { decideApproval } from '../lib/chat.js';
import { fetchProblems, scanProblems } from '../lib/problems.js';
import { useRoleTheme } from '../lib/RoleThemeContext.js';
import {
  advanceRemediationPlan,
  cancelRemediationPlan,
  createRemediationPlan,
  fetchRemediationPlans,
  replanRemediationPlan,
} from '../lib/remediation.js';
import type {
  BusinessProblemDto,
  DashboardResponse,
  PlanStepDto,
  RemediationPlanDto,
  RemediationPlanStatus,
} from '../lib/types.js';

/** The problems page (loads shell context, then the problems console). */
export function Problems(): JSX.Element {
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
  if (dashboard === null) {
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
            icon="⚠"
            title="Create a workspace first"
            description="Detection and remediation run per workspace. Set one up to see your problems."
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
      <ProblemsView
        organizationId={dashboard.organization.id}
        workspaceId={dashboard.workspace.id}
        organizationName={dashboard.organization.name}
        userDisplayName={dashboard.user.displayName}
      />
    </AppShell>
  );
}

/** Props of {@link ProblemsView}. */
export interface ProblemsViewProps {
  organizationId: string;
  workspaceId: string;
  organizationName: string;
  userDisplayName: string;
  /** Optional preloaded problems (server-rendered smoke tests). */
  initialProblems?: readonly BusinessProblemDto[];
  /** Optional preloaded expanded problem id (server-rendered smoke tests). */
  initialExpandedId?: string | null;
}

/** The pure problems content (exported for smoke tests). */
export function ProblemsView({
  organizationId,
  workspaceId,
  organizationName,
  userDisplayName,
  initialProblems,
  initialExpandedId,
}: ProblemsViewProps): JSX.Element {
  const scope = { organizationId, workspaceId };
  const [problems, setProblems] = useState<readonly BusinessProblemDto[]>(initialProblems ?? []);
  const [loading, setLoading] = useState(initialProblems === undefined);
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(initialExpandedId ?? null);
  const [filter, setFilter] = useState<'all' | 'high' | 'medium' | 'low' | 'resolved'>('all');

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setProblems(await fetchProblems(scope));
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Could not load problems');
    } finally {
      setLoading(false);
    }
  }, [organizationId, workspaceId]);

  useEffect(() => {
    if (initialProblems === undefined) {
      void load();
    }
  }, [load, initialProblems]);

  const rescan = useCallback(async () => {
    setScanning(true);
    setError(null);
    try {
      setProblems(await scanProblems(scope));
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Could not run detection');
    } finally {
      setScanning(false);
    }
  }, [organizationId, workspaceId]);

  /** Applies a fresh problem DTO (e.g. after a plan step re-evaluates it) into the list. */
  const patchProblem = useCallback((updated: BusinessProblemDto) => {
    setProblems((current) =>
      current.map((problem) => (problem.id === updated.id ? updated : problem)),
    );
  }, []);

  const highSeverity = problems.filter((problem) => problem.severity === 'high').length;
  const visibleProblems = problems.filter((problem) => {
    if (filter === 'all') return true;
    if (filter === 'resolved') return problem.status === 'RESOLVED';
    return problem.severity === filter;
  });

  return (
    <Stack gap={6} style={{ maxWidth: 1080, margin: '0 auto' }}>
      <Stack gap={1}>
        <div
          style={{
            fontSize: typography.sizes.xs,
            fontWeight: typography.weights.semibold,
            color: 'var(--nexora-textMuted)',
            textTransform: 'uppercase',
            letterSpacing: '0.08em',
          }}
        >
          Signals Nexora believes require attention
        </div>
        <Stack
          direction="row"
          gap={3}
          align="center"
          justify="space-between"
          style={{ flexWrap: 'wrap' }}
        >
          <Stack direction="row" gap={2} align="center" style={{ flexWrap: 'wrap' }}>
            <h1 style={{ fontSize: typography.sizes['2xl'], fontWeight: typography.weights.bold }}>
              Problems
            </h1>
            {problems.length > 0 ? (
              <Badge tone={highSeverity > 0 ? 'danger' : 'warning'} dot>
                {problems.length}
              </Badge>
            ) : null}
          </Stack>
          <Button variant="secondary" size="sm" onClick={() => void rescan()} disabled={scanning}>
            {scanning ? 'Scanning…' : 'Scan now'}
          </Button>
        </Stack>
        <p style={{ fontSize: typography.sizes.sm, color: 'var(--nexora-textSecondary)' }}>
          {organizationName} · detected automatically from real persisted data — understand what
          happened, find the known solution, and drive it through a governed remediation plan.
        </p>
      </Stack>

      {error !== null ? (
        <Card>
          <div
            role="alert"
            style={{ fontSize: typography.sizes.sm, color: 'var(--nexora-danger)' }}
          >
            {error}
          </div>
        </Card>
      ) : null}

      {loading ? (
        <div role="status" aria-live="polite" aria-label="Scanning your workspace">
          <Stack gap={3}>
            <ProblemRowSkeleton />
            <ProblemRowSkeleton />
          </Stack>
        </div>
      ) : problems.length === 0 ? (
        <Card>
          <EmptyState
            icon="✓"
            title="No problems detected"
            description="Nexora re-evaluates your workspace continuously. Try Scan now to force a fresh pass."
          />
        </Card>
      ) : (
        <Stack gap={3}>
          <Stack direction="row" gap={2} style={{ flexWrap: 'wrap' }}>
            {(['all', 'high', 'medium', 'low', 'resolved'] as const).map((option) => (
              <button
                key={option}
                type="button"
                onClick={() => setFilter(option)}
                style={{
                  border: '1px solid var(--nexora-border)',
                  borderRadius: 999,
                  padding: '5px 12px',
                  fontSize: typography.sizes.xs,
                  fontWeight: typography.weights.medium,
                  textTransform: 'capitalize',
                  cursor: 'pointer',
                  background: filter === option ? 'var(--nexora-primarySoft)' : 'transparent',
                  color: filter === option ? 'var(--nexora-text)' : 'var(--nexora-textSecondary)',
                  borderColor: filter === option ? 'var(--nexora-primary)' : 'var(--nexora-border)',
                }}
              >
                {option}
              </button>
            ))}
          </Stack>
          {visibleProblems.length === 0 ? (
            <Card>
              <EmptyState
                icon="⚬"
                title="No matching problems"
                description="Nothing matches this filter right now."
              />
            </Card>
          ) : (
            visibleProblems.map((problem) => (
              <ProblemCard
                key={problem.id}
                problem={problem}
                expanded={expandedId === problem.id}
                onToggle={() =>
                  setExpandedId((current) => (current === problem.id ? null : problem.id))
                }
                scope={scope}
                organizationName={organizationName}
                userDisplayName={userDisplayName}
                onProblemUpdated={patchProblem}
              />
            ))
          )}
        </Stack>
      )}
    </Stack>
  );
}

/** A skeleton placeholder shaped like a collapsed problem row (scan in progress). */
function ProblemRowSkeleton(): JSX.Element {
  return (
    <Card padding={5}>
      <Stack direction="row" gap={3} align="center" justify="space-between">
        <Stack gap={2} style={{ flex: 1 }}>
          <Stack direction="row" gap={2} align="center">
            <Skeleton height={16} width={220} />
            <Skeleton height={18} width={54} radiusValue="999px" />
          </Stack>
          <Skeleton height={12} width={320} />
        </Stack>
        <Skeleton height={30} width={84} radiusValue="8px" />
      </Stack>
    </Card>
  );
}

/** One problem card: summary row + (when expanded) full investigation + remediation plan. */
function ProblemCard({
  problem,
  expanded,
  onToggle,
  scope,
  organizationName,
  userDisplayName,
  onProblemUpdated,
}: {
  problem: BusinessProblemDto;
  expanded: boolean;
  onToggle: () => void;
  scope: { organizationId: string; workspaceId: string };
  organizationName: string;
  userDisplayName: string;
  onProblemUpdated: (problem: BusinessProblemDto) => void;
}): JSX.Element {
  return (
    <Card padding={5} style={{ borderLeft: `3px solid ${severityAccent(problem.severity)}` }}>
      <Stack gap={4}>
        <div
          role="button"
          tabIndex={0}
          onClick={onToggle}
          onKeyDown={(event) => {
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault();
              onToggle();
            }
          }}
          style={{
            display: 'flex',
            flexDirection: 'row',
            gap: 12,
            alignItems: 'center',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            cursor: 'pointer',
          }}
        >
          <Stack gap={0.5} style={{ minWidth: 0 }}>
            <Stack direction="row" gap={2} align="center" style={{ flexWrap: 'wrap' }}>
              <span
                style={{ fontWeight: typography.weights.semibold, fontSize: typography.sizes.md }}
              >
                {problem.title}
              </span>
              <Badge tone={severityTone(problem.severity)}>{problem.severity}</Badge>
              <Badge tone={statusTone(problem.status)}>{problem.status.replace(/_/g, ' ')}</Badge>
            </Stack>
            <div style={{ fontSize: typography.sizes.xs, color: 'var(--nexora-textSecondary)' }}>
              {problem.signalName} ·{' '}
              {problem.affectedEntities.map((entity) => entity.title).join(', ') ||
                problem.description}
            </div>
          </Stack>
          <Button
            variant="secondary"
            size="sm"
            onClick={(event) => {
              event.stopPropagation();
              onToggle();
            }}
          >
            {expanded ? 'Hide' : 'Investigate'}
          </Button>
        </div>

        {expanded ? (
          <Stack gap={5} style={{ borderTop: '1px solid var(--nexora-border)', paddingTop: 16 }}>
            <div style={{ fontSize: typography.sizes.sm, color: 'var(--nexora-textSecondary)' }}>
              {problem.description}
            </div>

            <ProblemInvestigation problem={problem} />

            <PlanSection
              problem={problem}
              scope={scope}
              organizationName={organizationName}
              userDisplayName={userDisplayName}
              onProblemUpdated={onProblemUpdated}
            />
          </Stack>
        ) : null}
      </Stack>
    </Card>
  );
}

/**
 * The remediation plan panel: create the plan, walk it step by step (each
 * step shows WHAT/WHY/WHICH capability/approval requirement), approve
 * through the existing approval surface, and watch verification + the
 * problem's re-evaluated status — the hero flow end to end.
 */
function PlanSection({
  problem,
  scope,
  organizationName,
  userDisplayName,
  onProblemUpdated,
}: {
  problem: BusinessProblemDto;
  scope: { organizationId: string; workspaceId: string };
  organizationName: string;
  userDisplayName: string;
  onProblemUpdated: (problem: BusinessProblemDto) => void;
}): JSX.Element {
  const [plan, setPlan] = useState<RemediationPlanDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [deciding, setDeciding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // S34 RBAC: presentation-only gating — the backend re-checks the SAME
  // permissions on the decide/advance routes regardless of what renders
  // here (this can never be the real access control).
  const { current } = useRoleTheme();
  const canDecide = current?.permissions.includes('approvals.decide') ?? false;
  const canExecute = current?.permissions.includes('agent.execute') ?? false;

  const loadExisting = useCallback(async () => {
    setLoading(true);
    try {
      const plans = await fetchRemediationPlans(scope);
      setPlan(plans.find((candidate) => candidate.problemId === problem.id) ?? null);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Could not load the remediation plan');
    } finally {
      setLoading(false);
    }
  }, [scope.organizationId, scope.workspaceId, problem.id]);

  useEffect(() => {
    void loadExisting();
  }, [loadExisting]);

  const applyPlan = useCallback(
    (next: RemediationPlanDto) => {
      setPlan(next);
      onProblemUpdated(next.problem);
    },
    [onProblemUpdated],
  );

  const create = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const applicable = problem.solutions.find((s) => s.applicability === 'APPLICABLE');
      applyPlan(await createRemediationPlan(scope, problem.id, applicable?.id));
    } catch (caught) {
      setError(
        caught instanceof ApiError ? caught.message : 'Could not create the remediation plan',
      );
    } finally {
      setBusy(false);
    }
  }, [scope, problem, applyPlan]);

  const advance = useCallback(async () => {
    if (plan === null) return;
    setBusy(true);
    setError(null);
    try {
      applyPlan(await advanceRemediationPlan(scope, plan.id));
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Could not advance the plan');
    } finally {
      setBusy(false);
    }
  }, [scope, plan, applyPlan]);

  const replan = useCallback(async () => {
    if (plan === null) return;
    setBusy(true);
    setError(null);
    try {
      applyPlan(await replanRemediationPlan(scope, plan.id));
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Could not re-plan');
    } finally {
      setBusy(false);
    }
  }, [scope, plan, applyPlan]);

  const cancel = useCallback(async () => {
    if (plan === null) return;
    setBusy(true);
    setError(null);
    try {
      applyPlan(await cancelRemediationPlan(scope, plan.id));
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Could not cancel the plan');
    } finally {
      setBusy(false);
    }
  }, [scope, plan, applyPlan]);

  const pendingStep = plan?.steps.find(
    (step) => step.status === 'AWAITING_APPROVAL' && step.approvalId !== undefined,
  );

  const decide = useCallback(
    async (decision: 'approve' | 'reject') => {
      if (pendingStep?.approvalId === undefined || deciding) return;
      setDeciding(true);
      setError(null);
      try {
        await decideApproval(pendingStep.approvalId, decision, {
          onError: (caught) => setError(caught.message),
        });
        // The plan engine owns the step/plan state transition — pull the
        // authoritative result through the SAME governed advance call
        // (exactly-once: the step's approval was already claimed above).
        await advance();
      } finally {
        setDeciding(false);
      }
    },
    [pendingStep, deciding, advance],
  );

  if (loading) {
    return (
      <Stack gap={2} style={{ borderTop: '1px solid var(--nexora-border)', paddingTop: 16 }}>
        <SectionLabel>Remediation plan</SectionLabel>
        <Skeleton height={40} radiusValue="10px" />
      </Stack>
    );
  }

  return (
    <Stack gap={3} style={{ borderTop: '1px solid var(--nexora-border)', paddingTop: 16 }}>
      <SectionLabel>Remediation plan</SectionLabel>

      {error !== null ? (
        <div role="alert" style={{ fontSize: typography.sizes.xs, color: 'var(--nexora-danger)' }}>
          {error}
        </div>
      ) : null}

      {plan === null ? (
        problem.status === 'RESOLVED' ? (
          <EmptyState
            icon="✓"
            title="Resolved"
            description="This problem has no open remediation."
          />
        ) : (
          <Stack gap={2} align="start">
            <p style={{ fontSize: typography.sizes.xs, color: 'var(--nexora-textMuted)' }}>
              Derive a step-by-step plan from the applicable known solution — every step is
              capability-bound and approval-gated where policy requires.
            </p>
            {canExecute ? (
              <Button
                size="sm"
                onClick={() => void create()}
                disabled={busy || !problem.solutions.some((s) => s.applicability === 'APPLICABLE')}
              >
                {busy ? 'Creating…' : 'Create remediation plan'}
              </Button>
            ) : (
              <p style={{ fontSize: typography.sizes.xs, color: 'var(--nexora-textMuted)' }}>
                Your current role does not have permission to execute a remediation plan.
              </p>
            )}
            {canExecute && !problem.solutions.some((s) => s.applicability === 'APPLICABLE') ? (
              <p style={{ fontSize: typography.sizes.xs, color: 'var(--nexora-textMuted)' }}>
                No applicable known solution yet — a plan cannot be built.
              </p>
            ) : null}
          </Stack>
        )
      ) : (
        <Stack gap={4}>
          <Stack gap={2}>
            <Stack direction="row" gap={2} align="center" style={{ flexWrap: 'wrap' }}>
              <Badge tone={planStatusTone(plan.status)}>{plan.status.replace(/_/g, ' ')}</Badge>
              <span
                style={{ fontSize: typography.sizes.sm, fontWeight: typography.weights.medium }}
              >
                {plan.objective}
              </span>
              {plan.replanCount > 0 ? <Badge>re-planned ×{plan.replanCount}</Badge> : null}
            </Stack>
            <PlanProgress steps={plan.steps} />
          </Stack>

          <Stack gap={2}>
            {plan.steps.map((step) => (
              <StepRow key={step.id} step={step} />
            ))}
          </Stack>

          {pendingStep !== undefined ? (
            <div
              role="group"
              aria-label="Approval required"
              style={{
                border: '1px solid var(--nexora-warning)',
                borderRadius: 12,
                background: 'var(--nexora-warningSoft)',
                padding: '14px 16px',
                display: 'flex',
                flexDirection: 'column',
                gap: 8,
              }}
            >
              <Stack direction="row" gap={2} align="center">
                <span
                  aria-hidden
                  style={{
                    width: 26,
                    height: 26,
                    borderRadius: '50%',
                    background: 'var(--nexora-warning)',
                    color: '#fff',
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: typography.sizes.sm,
                    flexShrink: 0,
                  }}
                >
                  !
                </span>
                <div
                  style={{ fontSize: typography.sizes.sm, fontWeight: typography.weights.semibold }}
                >
                  Your approval is required — step {pendingStep.sequence}: {pendingStep.action}
                </div>
              </Stack>
              <div style={{ fontSize: typography.sizes.xs, color: 'var(--nexora-textSecondary)' }}>
                {pendingStep.rationale}
              </div>
              <div
                style={{
                  fontSize: typography.sizes.xs,
                  color: 'var(--nexora-textMuted)',
                  fontFamily: typography.fontMono,
                }}
              >
                {userDisplayName} · {organizationName} · {pendingStep.capabilityId}
              </div>
              {canDecide ? (
                <Stack direction="row" gap={2}>
                  <Button size="sm" onClick={() => void decide('approve')} disabled={deciding}>
                    {deciding ? 'Deciding…' : 'Approve'}
                  </Button>
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => void decide('reject')}
                    disabled={deciding}
                  >
                    Reject
                  </Button>
                </Stack>
              ) : (
                <div style={{ fontSize: typography.sizes.xs, color: 'var(--nexora-textMuted)' }}>
                  Your current role does not have permission to decide this approval.
                </div>
              )}
            </div>
          ) : null}

          {plan.outcome !== undefined ? (
            <div
              style={{
                display: 'flex',
                gap: 12,
                alignItems: 'flex-start',
                background:
                  plan.outcome.status === 'resolved'
                    ? 'var(--nexora-successSoft)'
                    : 'var(--nexora-warningSoft)',
                borderRadius: 10,
                padding: '14px 16px',
              }}
            >
              <span
                aria-hidden
                style={{
                  width: 26,
                  height: 26,
                  borderRadius: '50%',
                  background:
                    plan.outcome.status === 'resolved'
                      ? 'var(--nexora-success)'
                      : 'var(--nexora-warning)',
                  color: '#fff',
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: typography.sizes.sm,
                  flexShrink: 0,
                }}
              >
                {plan.outcome.status === 'resolved' ? '✓' : '!'}
              </span>
              <div>
                <div
                  style={{ fontSize: typography.sizes.sm, fontWeight: typography.weights.semibold }}
                >
                  {plan.outcome.status === 'resolved' ? 'Problem resolved' : 'Not yet resolved'}
                </div>
                <div
                  style={{ fontSize: typography.sizes.sm, color: 'var(--nexora-textSecondary)' }}
                >
                  {plan.outcome.finalVerification}
                </div>
              </div>
            </div>
          ) : plan.reason !== undefined ? (
            <div style={{ fontSize: typography.sizes.sm, color: 'var(--nexora-textSecondary)' }}>
              {plan.reason}
            </div>
          ) : null}

          <Stack direction="row" gap={2} style={{ flexWrap: 'wrap' }}>
            {isExecutable(plan.status) && pendingStep === undefined ? (
              canExecute ? (
                <Button size="sm" onClick={() => void advance()} disabled={busy}>
                  {busy ? 'Working…' : 'Run next step'}
                </Button>
              ) : (
                <div style={{ fontSize: typography.sizes.xs, color: 'var(--nexora-textMuted)' }}>
                  Your current role does not have permission to execute this plan.
                </div>
              )
            ) : null}
            {plan.status === 'BLOCKED' || plan.status === 'FAILED' ? (
              <Button size="sm" variant="secondary" onClick={() => void replan()} disabled={busy}>
                Re-plan
              </Button>
            ) : null}
            {!isTerminal(plan.status) ? (
              <Button size="sm" variant="secondary" onClick={() => void cancel()} disabled={busy}>
                Cancel
              </Button>
            ) : null}
          </Stack>
        </Stack>
      )}
    </Stack>
  );
}

/** A thin live-progress bar: verified steps / total steps. */
function PlanProgress({ steps }: { steps: readonly PlanStepDto[] }): JSX.Element | null {
  if (steps.length === 0) return null;
  const verified = steps.filter((step) => step.status === 'VERIFIED').length;
  const failed = steps.some((step) => step.status === 'FAILED' || step.status === 'BLOCKED');
  const pct = Math.round((verified / steps.length) * 100);
  return (
    <Stack gap={1}>
      <div
        style={{
          height: 6,
          borderRadius: 999,
          background: 'var(--nexora-surfaceMuted)',
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            height: '100%',
            width: `${pct}%`,
            borderRadius: 999,
            background: failed ? 'var(--nexora-danger)' : 'var(--nexora-primary)',
            transition: 'width 320ms cubic-bezier(0.16, 1, 0.3, 1)',
          }}
        />
      </div>
      <span style={{ fontSize: typography.sizes.xs, color: 'var(--nexora-textMuted)' }}>
        Step {Math.min(verified + 1, steps.length)} of {steps.length}
      </span>
    </Stack>
  );
}

/** One plan step row: sequence, WHAT, WHY, capability, approval, status. */
function StepRow({ step }: { step: PlanStepDto }): JSX.Element {
  const { summary, technical } = splitStepEvidence(step.evidence);
  const running = step.status === 'RUNNING';
  return (
    <div
      style={{
        border: '1px solid var(--nexora-border)',
        borderRadius: 10,
        padding: '12px 14px',
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
        background: running ? 'var(--nexora-aiSoft)' : undefined,
      }}
    >
      <Stack
        direction="row"
        gap={2}
        align="center"
        justify="space-between"
        style={{ flexWrap: 'wrap' }}
      >
        <Stack direction="row" gap={2.5} align="center">
          <StepStatusIcon status={step.status} />
          <span style={{ fontWeight: typography.weights.medium, fontSize: typography.sizes.sm }}>
            {step.sequence}. {step.action}
          </span>
        </Stack>
        <Badge tone={stepStatusTone(step.status)}>{step.status.replace(/_/g, ' ')}</Badge>
      </Stack>
      <div
        style={{
          fontSize: typography.sizes.xs,
          color: 'var(--nexora-textSecondary)',
          paddingLeft: 34,
        }}
      >
        {step.rationale}
      </div>
      <Stack direction="row" gap={2} align="center" style={{ flexWrap: 'wrap', paddingLeft: 34 }}>
        <span
          style={{
            fontSize: typography.sizes.xs,
            fontFamily: typography.fontMono,
            color: 'var(--nexora-textMuted)',
          }}
        >
          {step.capabilityId}
        </span>
        <Badge tone={step.approvalRequirement === 'REQUIRED' ? 'warning' : 'neutral'}>
          {step.approvalRequirement === 'REQUIRED' ? 'Approval required' : 'No approval needed'}
        </Badge>
      </Stack>
      {summary !== undefined ? (
        <div
          style={{
            fontSize: typography.sizes.xs,
            color: 'var(--nexora-textMuted)',
            paddingLeft: 34,
          }}
        >
          {summary}
          {technical !== undefined ? (
            <details style={{ marginTop: 4 }}>
              <summary style={{ cursor: 'pointer', color: 'var(--nexora-textMuted)' }}>
                Technical output
              </summary>
              <pre
                style={{
                  marginTop: 6,
                  padding: 8,
                  borderRadius: 6,
                  background: 'var(--nexora-surfaceMuted)',
                  fontSize: typography.sizes.xs,
                  fontFamily: typography.fontMono,
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-word',
                  maxHeight: 160,
                  overflowY: 'auto',
                }}
              >
                {technical}
              </pre>
            </details>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/** A small status glyph in a colored circle (matches the status badge tone). */
function StepStatusIcon({ status }: { status: PlanStepDto['status'] }): JSX.Element {
  const tone = stepStatusTone(status);
  const background =
    tone === 'success'
      ? 'var(--nexora-success)'
      : tone === 'danger'
        ? 'var(--nexora-danger)'
        : tone === 'ai'
          ? 'var(--nexora-ai)'
          : tone === 'warning'
            ? 'var(--nexora-warning)'
            : 'var(--nexora-borderStrong)';
  return (
    <span
      aria-hidden
      style={{
        width: 22,
        height: 22,
        borderRadius: '50%',
        background,
        color: '#fff',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: 11,
        flexShrink: 0,
        animation:
          status === 'RUNNING'
            ? 'nexora-pulse 1.1s cubic-bezier(0.2, 0, 0, 1) infinite'
            : undefined,
      }}
    >
      {stepIcon(status)}
    </span>
  );
}

/**
 * Splits a step's evidence into a clean human summary and (when the raw
 * execution output was embedded as JSON) a collapsed technical block — the
 * user sees "done, verified", not a raw payload dump.
 */
function splitStepEvidence(
  // Persisted steps that have never executed carry a null JSONB column, not
  // an absent field — accept both so a PENDING step never crashes the row.
  evidence: readonly string[] | null | undefined,
): { summary?: string; technical?: string } {
  if (evidence === undefined || evidence === null || evidence.length === 0) return {};
  const line = evidence.join(' · ');
  const jsonStart = line.indexOf('{');
  if (jsonStart === -1) return { summary: line };
  const summary = line
    .slice(0, jsonStart)
    .replace(/[—-]\s*$/, '')
    .trim();
  return {
    summary: summary.length > 0 ? summary : 'Completed — see technical output.',
    technical: line,
  };
}

/** Whether a plan may run its next step right now. */
function isExecutable(status: RemediationPlanStatus): boolean {
  return status === 'READY' || status === 'EXECUTING' || status === 'AWAITING_APPROVAL';
}

/** Whether a plan is done (no further action possible). */
function isTerminal(status: RemediationPlanStatus): boolean {
  return status === 'COMPLETED' || status === 'FAILED' || status === 'CANCELLED';
}

/** Maps a problem status to a badge tone. */
function statusTone(
  status: BusinessProblemDto['status'],
): 'success' | 'warning' | 'primary' | undefined {
  if (status === 'RESOLVED') return 'success';
  if (status === 'WAITING_FOR_APPROVAL' || status === 'ACTION_PROPOSED') return 'warning';
  if (status === 'NO_SOLUTION_FOUND') return undefined;
  return 'primary';
}

/** Maps a plan status to a badge tone. */
function planStatusTone(
  status: RemediationPlanStatus,
): 'success' | 'warning' | 'danger' | 'ai' | 'primary' | undefined {
  if (status === 'COMPLETED') return 'success';
  if (status === 'AWAITING_APPROVAL' || status === 'REPLANNING' || status === 'PAUSED') {
    return 'warning';
  }
  if (status === 'FAILED' || status === 'BLOCKED' || status === 'CANCELLED') return 'danger';
  if (status === 'EXECUTING') return 'ai';
  return 'primary';
}

/** Maps a step status to a badge tone. */
function stepStatusTone(
  status: PlanStepDto['status'],
): 'success' | 'warning' | 'danger' | 'ai' | undefined {
  if (status === 'VERIFIED') return 'success';
  if (status === 'AWAITING_APPROVAL') return 'warning';
  if (status === 'FAILED' || status === 'BLOCKED') return 'danger';
  if (status === 'RUNNING') return 'ai';
  return undefined;
}

/** The step icon (checkmark / cross / ellipsis) by status. */
function stepIcon(status: PlanStepDto['status']): string {
  if (status === 'VERIFIED') return '✓';
  if (status === 'FAILED' || status === 'BLOCKED') return '✕';
  if (status === 'SKIPPED') return '–';
  return '…';
}
