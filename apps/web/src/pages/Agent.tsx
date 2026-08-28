/**
 * @nexora/app-web — Agent page (S26 Phase 8).
 *
 * The GENERIC governed business-agent page. There is ONE page for every
 * role: the server resolves the caller's effective domain/role/agent/
 * capabilities from trusted membership and returns the agent definition +
 * governed proposals + recent runs; this page only renders and lets the
 * user EXECUTE a proposal (or ask the agent) through the existing governed
 * path. No ExecutiveAgent/ManagerAgent/DeveloperAgent page exists — the
 * role determines the agent, never the page.
 *
 * Execution surfaces an approval card when a write is gated; the decision
 * goes through the EXISTING `/api/ai/approvals/:id/decision` surface (the
 * same one the AI chat uses) — one approval system. Loading, error, empty,
 * and success states mirror the other application views.
 */

import { useCallback, useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Badge, Button, Card, EmptyState, Stack, typography } from '@nexora/design-system';

import { AppShell } from '../components/AppShell.js';
import { ErrorState } from '../components/ErrorState.js';
import { LoadingScreen } from '../components/LoadingScreen.js';
import { ApprovalCard } from '../components/AiPanel.js';
import {
  ProblemInvestigation,
  severityAccent,
  severityTone,
} from '../components/ProblemInvestigation.js';
import { api, ApiError } from '../lib/api.js';
import { decideApproval, type ChatDone } from '../lib/chat.js';
import { executeAgentIntent, executeProposal, fetchAgent } from '../lib/agent.js';
import { humanizeIdentifier, humanizeProblemText, humanizeProblemTitle } from '../lib/humanize.js';
import type {
  AgentExecutionOutcome,
  AgentExecutionResponse,
  AgentProposal,
  BusinessAgentDto,
  BusinessProblemDto,
  DashboardResponse,
} from '../lib/types.js';
import { useSession } from '../session.js';

/** The agent application page (loads shell context + agent). */
export function Agent(): JSX.Element {
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
            description="The governed agent is composed per workspace. Set one up to see your agent."
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
      <AgentView
        organizationId={dashboard.organization.id}
        workspaceId={dashboard.workspace.id}
        organizationName={dashboard.organization.name}
        userDisplayName={dashboard.user.displayName}
      />
    </AppShell>
  );
}

/** Props of {@link AgentView}. */
export interface AgentViewProps {
  /** The current organization id (trusted scope). */
  organizationId: string;
  /** The current workspace id (trusted scope). */
  workspaceId: string;
  /** The current organization name (approval card context). */
  organizationName: string;
  /** The current user's display name (approval card context). */
  userDisplayName: string;
  /** Optional preloaded agent (server-rendered smoke tests). */
  initialAgent?: BusinessAgentDto | null;
}

/** The pure agent content (exported for smoke tests). */
export function AgentView({
  organizationId,
  workspaceId,
  organizationName,
  userDisplayName,
  initialAgent,
}: AgentViewProps): JSX.Element {
  const scope = { organizationId, workspaceId };
  const [agent, setAgent] = useState<BusinessAgentDto | null>(initialAgent ?? null);
  const [loading, setLoading] = useState(initialAgent === undefined);
  const [error, setError] = useState<ApiError | null>(null);
  const [execution, setExecution] = useState<AgentExecutionResponse | null>(null);
  const [executingId, setExecutingId] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [deciding, setDeciding] = useState(false);
  const [executionError, setExecutionError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setAgent(await fetchAgent(scope));
    } catch (caught) {
      setError(
        caught instanceof ApiError ? caught : new ApiError(0, 'INTERNAL_ERROR', 'Request failed'),
      );
    } finally {
      setLoading(false);
    }
  }, [organizationId, workspaceId]);

  useEffect(() => {
    if (initialAgent === undefined) {
      void load();
    }
  }, [load, initialAgent]);

  /** Executes a governed proposal; the server re-derives + validates it. */
  const runProposal = useCallback(
    async (proposalId: string) => {
      setExecutingId(proposalId);
      setExecutionError(null);
      try {
        setExecution(await executeProposal(scope, proposalId));
        // Refresh the proposal set + recent runs after the run.
        void load();
      } catch (caught) {
        setExecutionError(
          caught instanceof ApiError ? caught.message : 'The agent could not execute the action',
        );
      } finally {
        setExecutingId(null);
      }
    },
    [organizationId, workspaceId, load],
  );

  /** Executes a free-form intent bound to the agent's capability set. */
  const runIntent = useCallback(
    async (raw: string) => {
      const utterance = raw.trim();
      if (utterance.length === 0) {
        return;
      }
      setExecutingId('free-form');
      setExecutionError(null);
      try {
        setExecution(await executeAgentIntent(scope, utterance));
        setDraft('');
        void load();
      } catch (caught) {
        setExecutionError(
          caught instanceof ApiError ? caught.message : 'The agent could not execute the request',
        );
      } finally {
        setExecutingId(null);
      }
    },
    [organizationId, workspaceId, load],
  );

  /** Approves the pending write through the EXISTING approval surface. */
  const approve = useCallback(async () => {
    const pending = execution?.outcome.approvals.find(
      (approval) => approval.status === 'pending' && approval.id !== undefined,
    );
    if (pending?.id === undefined || deciding) {
      return;
    }
    setDeciding(true);
    setExecutionError(null);
    try {
      await decideApproval(pending.id, 'approve', {
        onDone: (done: ChatDone) => {
          setExecution((current) =>
            current === null
              ? current
              : {
                  ...current,
                  outcome: { ...current.outcome, status: 'completed', response: done.response },
                },
          );
          void load();
        },
        onError: (caught) => {
          setExecutionError(caught.message);
        },
      });
    } finally {
      setDeciding(false);
    }
  }, [deciding, execution, load]);

  /** Rejects the pending write: the decision is recorded, nothing executes. */
  const reject = useCallback(async () => {
    const pending = execution?.outcome.approvals.find(
      (approval) => approval.status === 'pending' && approval.id !== undefined,
    );
    if (pending?.id === undefined || deciding) {
      return;
    }
    setDeciding(true);
    setExecutionError(null);
    try {
      await decideApproval(pending.id, 'reject', {
        onError: (caught) => {
          setExecutionError(caught.message);
        },
      });
      setExecution((current) =>
        current === null
          ? current
          : { ...current, outcome: { ...current.outcome, status: 'rejected' } },
      );
      void load();
    } finally {
      setDeciding(false);
    }
  }, [deciding, execution, load]);

  return (
    <Stack gap={6} style={{ maxWidth: 1080, margin: '0 auto' }}>
      {/* Identity / context header */}
      <Stack gap={1}>
        <Stack direction="row" gap={2} align="center" style={{ flexWrap: 'wrap' }}>
          <h1 style={{ fontSize: typography.sizes['3xl'], fontWeight: typography.weights.bold, letterSpacing: '-0.03em', lineHeight: 1.1 }}>
            Agent
          </h1>
          {agent !== null ? (
            <Badge tone="primary" dot>
              {agent.domainName} · {agent.roleName}
            </Badge>
          ) : null}
        </Stack>
        <p style={{ fontSize: typography.sizes.sm, color: 'var(--nexora-textSecondary)' }}>
          {organizationName} · {agent?.description ?? 'Your governed business agent'}
        </p>
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
          <EmptyState icon="✦" title="Resolving your agent…" description="Please wait." />
        </Card>
      ) : agent === null ? (
        <Card>
          <EmptyState
            icon="✦"
            title="No agent for your role"
            description="Your role does not have a governed agent configured."
          />
        </Card>
      ) : (
        <Stack gap={6}>
          <AgentIdentity agent={agent} />
          <ProblemList
            problems={agent.problems}
            executingId={executingId}
            onExecute={(proposal) => void runProposal(proposal.id)}
          />
          <ProposalList
            agent={agent}
            executingId={executingId}
            onExecute={(proposal) => void runProposal(proposal.id)}
          />
          <FreeFormComposer
            draft={draft}
            setDraft={setDraft}
            disabled={executingId !== null}
            onRun={(utterance) => void runIntent(utterance)}
          />
          {executionError !== null ? (
            <Card>
              <div
                role="alert"
                style={{ fontSize: typography.sizes.sm, color: 'var(--nexora-danger)' }}
              >
                {executionError}
              </div>
            </Card>
          ) : null}
          {execution !== null ? (
            <ExecutionPanel
              outcome={execution.outcome}
              organizationName={organizationName}
              userDisplayName={userDisplayName}
              deciding={deciding}
              onApprove={() => void approve()}
              onReject={() => void reject()}
            />
          ) : null}
          <RecentRuns runs={agent.recentRuns} />
        </Stack>
      )}
    </Stack>
  );
}

/** The agent identity block: definition, autonomy, goals, policies, capabilities. */
function AgentIdentity({ agent }: { agent: BusinessAgentDto }): JSX.Element {
  return (
    <Stack direction="row" gap={4} style={{ flexWrap: 'wrap' }}>
      <Card padding={5} style={{ flex: 1, minWidth: 280 }}>
        <Stack gap={1}>
          <Stack direction="row" gap={2} align="center" style={{ flexWrap: 'wrap' }}>
            <h2 style={{ fontSize: typography.sizes.lg, fontWeight: typography.weights.semibold }}>
              {agent.name}
            </h2>
            <Badge tone="ai">{autonomyLabel(agent.autonomyLevel)}</Badge>
          </Stack>
          <p style={{ fontSize: typography.sizes.sm, color: 'var(--nexora-textSecondary)' }}>
            {agent.description}
          </p>
        </Stack>
      </Card>
      <Card padding={5} style={{ flex: 1, minWidth: 280 }}>
        <Stack gap={2}>
          <h3 style={{ fontSize: typography.sizes.sm, fontWeight: typography.weights.semibold }}>
            Goals
          </h3>
          {agent.goals.length === 0 ? (
            <EmptyState title="No goals" />
          ) : (
            agent.goals.map((goal) => (
              <div key={goal.id} style={{ fontSize: typography.sizes.sm }}>
                <span style={{ fontWeight: typography.weights.medium }}>{goal.name}</span>
                <div style={{ fontSize: typography.sizes.xs, color: 'var(--nexora-textMuted)' }}>
                  {goal.description}
                </div>
              </div>
            ))
          )}
          <h3 style={{ fontSize: typography.sizes.sm, fontWeight: typography.weights.semibold }}>
            Operating policies
          </h3>
          {agent.policies.map((policy) => (
            <div key={policy.id} style={{ fontSize: typography.sizes.xs }}>
              <span style={{ color: 'var(--nexora-textSecondary)' }}>{policy.statement}</span>
            </div>
          ))}
        </Stack>
      </Card>
    </Stack>
  );
}

/**
 * The detected problems of the caller's scope (S27): one card per problem
 * with its grounded investigation (evidence, root-cause candidates,
 * discovered solutions, deterministic recommendation). A problem whose
 * recommendation carries a governed action proposal surfaces an Execute
 * button — the proposal is ALSO in the agent's executable proposal list
 * (S27 §13), so executing it flows through the SAME governed path.
 */
function ProblemList({
  problems,
  executingId,
  onExecute,
}: {
  problems: readonly BusinessProblemDto[];
  executingId: string | null;
  onExecute: (proposal: AgentProposal) => void;
}): JSX.Element {
  return (
    <Card padding={5}>
      <Stack gap={1} style={{ marginBottom: 12 }}>
        <Stack direction="row" gap={2} align="center" style={{ flexWrap: 'wrap' }}>
          <h2 style={{ fontSize: typography.sizes.md, fontWeight: typography.weights.semibold }}>
            Detected problems
          </h2>
          {problems.length > 0 ? (
            <Badge tone={problems.some((p) => p.severity === 'high') ? 'danger' : 'warning'} dot>
              {problems.length}
            </Badge>
          ) : null}
        </Stack>
        <p style={{ fontSize: typography.sizes.xs, color: 'var(--nexora-textMuted)' }}>
          Detected automatically from real persisted data — evidence is grounded, root-cause
          candidates separate FACT from INFERENCE, and solutions come from existing knowledge (never
          invented).
        </p>
      </Stack>
      {problems.length === 0 ? (
        <EmptyState
          icon="✓"
          title="No problems detected"
          description="The proactive detection layer re-evaluates your scope on every visit."
        />
      ) : (
        <Stack gap={4}>
          {problems.map((problem) => (
            <ProblemRow
              key={problem.id}
              problem={problem}
              busy={executingId === problem.recommendation?.actionProposal?.id}
              disabled={executingId !== null}
              onExecute={
                problem.recommendation?.actionProposal === undefined
                  ? undefined
                  : () => {
                      if (problem.recommendation?.actionProposal !== undefined) {
                        onExecute(problem.recommendation.actionProposal);
                      }
                    }
              }
            />
          ))}
        </Stack>
      )}
    </Card>
  );
}

/** One problem row: title/severity, evidence, root causes, solutions, recommendation. */
function ProblemRow({
  problem,
  busy,
  disabled,
  onExecute,
}: {
  problem: BusinessProblemDto;
  busy: boolean;
  disabled: boolean;
  onExecute: (() => void) | undefined;
}): JSX.Element {
  const proposal = problem.recommendation?.actionProposal;
  return (
    <div
      style={{
        border: '1px solid var(--nexora-border)',
        borderLeft: `3px solid ${severityAccent(problem.severity)}`,
        borderRadius: 12,
        padding: '14px 16px',
        display: 'flex',
        flexDirection: 'column',
        gap: 12,
      }}
    >
      <Stack
        direction="row"
        gap={3}
        align="center"
        justify="space-between"
        style={{ flexWrap: 'wrap' }}
      >
        <Stack gap={0.5} style={{ minWidth: 0 }}>
          <Stack direction="row" gap={2} align="center" style={{ flexWrap: 'wrap' }}>
            <span style={{ fontWeight: typography.weights.medium }}>
              {humanizeProblemTitle(problem.title)}
            </span>
            <Badge tone={severityTone(problem.severity)}>{problem.severity}</Badge>
            <Badge>{problem.status.replace(/_/g, ' ')}</Badge>
          </Stack>
          <div style={{ fontSize: typography.sizes.xs, color: 'var(--nexora-textSecondary)' }}>
            {problem.signalName} ·{' '}
            {problem.affectedEntities.map((entity) => entity.title).join(', ') ||
              humanizeProblemText(problem.description)}
          </div>
        </Stack>
        <Stack direction="row" gap={2} align="center" style={{ flexWrap: 'wrap' }}>
          {proposal !== undefined && onExecute !== undefined ? (
            <Button size="sm" onClick={onExecute} disabled={disabled}>
              {busy ? 'Executing…' : 'Apply known solution'}
            </Button>
          ) : null}
          {/* The agent's proposal is ONE governed step (the caller's first
              executable capability for this signal) — the full multi-step,
              approval-gated plan (every capability, in order) lives on the
              Problems console. Always point there so "what will Nexora
              actually do end to end" has one unambiguous answer. */}
          <Link
            to={`/app/problems?organizationId=${encodeURIComponent(problem.tenantId)}${
              problem.workspaceId === undefined
                ? ''
                : `&workspaceId=${encodeURIComponent(problem.workspaceId)}`
            }`}
            style={{ textDecoration: 'none' }}
          >
            <Button size="sm" variant="secondary">
              Full remediation plan →
            </Button>
          </Link>
        </Stack>
      </Stack>

      <div style={{ fontSize: typography.sizes.sm, color: 'var(--nexora-textSecondary)' }}>
        {humanizeProblemText(problem.description)}
      </div>

      <ProblemInvestigation problem={problem} />
    </div>
  );
}

/** The governed proposals: one card per grounded action, with Execute. */
function ProposalList({
  agent,
  executingId,
  onExecute,
}: {
  agent: BusinessAgentDto;
  executingId: string | null;
  onExecute: (proposal: AgentProposal) => void;
}): JSX.Element {
  return (
    <Card padding={5}>
      <Stack gap={1} style={{ marginBottom: 12 }}>
        <h2 style={{ fontSize: typography.sizes.md, fontWeight: typography.weights.semibold }}>
          Suggested actions
        </h2>
        <p style={{ fontSize: typography.sizes.xs, color: 'var(--nexora-textMuted)' }}>
          Derived from real persisted data — the agent never fabricates business state.
        </p>
      </Stack>
      {agent.proposals.length === 0 ? (
        <EmptyState
          icon="✓"
          title="Nothing to propose"
          description="Grounded suggestions appear here as real data accumulates."
        />
      ) : (
        <Stack gap={3}>
          {agent.proposals.map((proposal) => (
            <ProposalRow
              key={proposal.id}
              proposal={proposal}
              busy={executingId === proposal.id}
              disabled={executingId !== null}
              onExecute={() => onExecute(proposal)}
            />
          ))}
        </Stack>
      )}
    </Card>
  );
}

/** One proposal row: WHAT, WHY, WHERE, capability + approval requirement. */
function ProposalRow({
  proposal,
  busy,
  disabled,
  onExecute,
}: {
  proposal: AgentProposal;
  busy: boolean;
  disabled: boolean;
  onExecute: () => void;
}): JSX.Element {
  return (
    <div
      style={{
        border: '1px solid var(--nexora-border)',
        borderRadius: 12,
        padding: '12px 14px',
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
      }}
    >
      <Stack
        direction="row"
        gap={3}
        align="center"
        justify="space-between"
        style={{ flexWrap: 'wrap' }}
      >
        <Stack gap={0.5} style={{ minWidth: 0 }}>
          <div style={{ fontWeight: typography.weights.medium }}>{proposal.action}</div>
          <div style={{ fontSize: typography.sizes.xs, color: 'var(--nexora-textSecondary)' }}>
            {proposal.reason}
          </div>
        </Stack>
        <Button size="sm" onClick={onExecute} disabled={disabled}>
          {busy ? 'Executing…' : proposal.requiresApproval ? 'Propose & approve' : 'Execute'}
        </Button>
      </Stack>
      <Stack direction="row" gap={2} style={{ flexWrap: 'wrap' }}>
        {proposal.affectedEntity !== undefined ? (
          <Badge>{`${proposal.affectedEntity.type}: ${proposal.affectedEntity.title}`}</Badge>
        ) : null}
        <Badge tone="ai">{proposal.targetSystem}</Badge>
        <Badge>{humanizeIdentifier(proposal.requiredCapability)}</Badge>
        <Badge tone={proposal.requiresApproval ? 'warning' : undefined}>
          {proposal.requiresApproval ? 'Approval required' : 'Read only'}
        </Badge>
      </Stack>
    </div>
  );
}

/** The free-form ask-the-agent composer (bound to the agent's capability set). */
function FreeFormComposer({
  draft,
  setDraft,
  disabled,
  onRun,
}: {
  draft: string;
  setDraft: (value: string) => void;
  disabled: boolean;
  onRun: (utterance: string) => void;
}): JSX.Element {
  return (
    <Card padding={5}>
      <Stack gap={2}>
        <h2 style={{ fontSize: typography.sizes.md, fontWeight: typography.weights.semibold }}>
          Ask your agent
        </h2>
        <p style={{ fontSize: typography.sizes.xs, color: 'var(--nexora-textMuted)' }}>
          The request is bound to your agent's registered capabilities — it can never reach a
          capability outside them.
        </p>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            onRun(draft);
          }}
          style={{ display: 'flex', gap: 8 }}
        >
          <input
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder="e.g. What needs my attention?"
            aria-label="Ask your agent"
            disabled={disabled}
            style={{
              flex: 1,
              padding: '9px 12px',
              background: 'var(--nexora-surfaceMuted)',
              border: '1px solid var(--nexora-borderStrong)',
              borderRadius: 10,
              fontSize: typography.sizes.base,
              color: 'var(--nexora-text)',
              outline: 'none',
            }}
          />
          <Button type="submit" disabled={disabled || draft.trim().length === 0} size="sm">
            {disabled ? '…' : 'Ask'}
          </Button>
        </form>
      </Stack>
    </Card>
  );
}

/** The governed execution panel: status, steps, approvals, decision. */
function ExecutionPanel({
  outcome,
  organizationName,
  userDisplayName,
  deciding,
  onApprove,
  onReject,
}: {
  outcome: AgentExecutionOutcome;
  organizationName: string;
  userDisplayName: string;
  deciding: boolean;
  onApprove: () => void;
  onReject: () => void;
}): JSX.Element {
  const pending = outcome.approvals.find(
    (approval) => approval.status === 'pending' && approval.id !== undefined,
  );
  return (
    <Card padding={5}>
      <Stack gap={3}>
        <Stack direction="row" gap={2} align="center" style={{ flexWrap: 'wrap' }}>
          <h2 style={{ fontSize: typography.sizes.md, fontWeight: typography.weights.semibold }}>
            Execution
          </h2>
          <Badge tone={statusTone(outcome.status)}>{outcome.status}</Badge>
          {outcome.runId !== undefined ? (
            <span style={{ fontSize: typography.sizes.xs, color: 'var(--nexora-textMuted)' }}>
              {outcome.runId}
            </span>
          ) : null}
        </Stack>

        {outcome.steps.length > 0 ? (
          <Stack gap={2}>
            {outcome.steps.map((step) => (
              <div
                key={step.stepId}
                style={{
                  display: 'flex',
                  gap: 8,
                  alignItems: 'baseline',
                  fontSize: typography.sizes.sm,
                }}
              >
                <span aria-hidden style={{ width: 16, textAlign: 'center' }}>
                  {step.status === 'succeeded' ? '✓' : step.status === 'failed' ? '✕' : '…'}
                </span>
                <span style={{ fontWeight: typography.weights.medium }} title={step.toolId}>
                  {humanizeIdentifier(step.toolId)}
                </span>
                {step.verified ? (
                  <span style={{ fontSize: typography.sizes.xs, color: 'var(--nexora-success)' }}>
                    verified
                  </span>
                ) : null}
                {step.error !== undefined ? (
                  <span style={{ fontSize: typography.sizes.xs, color: 'var(--nexora-danger)' }}>
                    {step.error}
                  </span>
                ) : null}
              </div>
            ))}
          </Stack>
        ) : null}

        {pending !== undefined ? (
          <ApprovalCard
            approval={{
              ...pending,
              // The card requires a capability label — fall back to the tool.
              capabilityId: pending.capabilityId ?? pending.toolId,
            }}
            organizationName={organizationName}
            userDisplayName={userDisplayName}
            deciding={deciding}
            onApprove={onApprove}
            onReject={onReject}
          />
        ) : null}

        {outcome.decision !== undefined ? (
          <div style={{ fontSize: typography.sizes.xs, color: 'var(--nexora-textMuted)' }}>
            Decision {outcome.decision.id} · {outcome.decision.outcome} ·{' '}
            {new Date(outcome.decision.madeAt).toLocaleString()}
          </div>
        ) : null}

        <div
          style={{
            fontSize: typography.sizes.sm,
            whiteSpace: 'pre-wrap',
            overflowWrap: 'anywhere',
            borderTop: '1px solid var(--nexora-border)',
            paddingTop: 12,
          }}
        >
          {outcome.response}
        </div>
      </Stack>
    </Card>
  );
}

/** The recent-runs journal (S26 measurements). */
function RecentRuns({ runs }: { runs: BusinessAgentDto['recentRuns'] }): JSX.Element {
  return (
    <Card padding={5}>
      <Stack gap={2}>
        <h2 style={{ fontSize: typography.sizes.md, fontWeight: typography.weights.semibold }}>
          Recent runs
        </h2>
        {runs.length === 0 ? (
          <EmptyState
            icon="▫"
            title="No runs yet"
            description="Governed executions are journaled here as they happen."
          />
        ) : (
          runs.map((run) => (
            <div
              key={run.id}
              style={{
                display: 'flex',
                gap: 8,
                alignItems: 'center',
                fontSize: typography.sizes.sm,
                flexWrap: 'wrap',
              }}
            >
              <Badge tone={statusTone(run.status)}>{run.status}</Badge>
              <span style={{ fontWeight: typography.weights.medium }}>
                {run.proposalAction ?? run.runId ?? run.id}
              </span>
              <span style={{ fontSize: typography.sizes.xs, color: 'var(--nexora-textMuted)' }}>
                {new Date(run.createdAt).toLocaleString()}
              </span>
            </div>
          ))
        )}
      </Stack>
    </Card>
  );
}

/** A human-readable autonomy label. */
function autonomyLabel(level: BusinessAgentDto['autonomyLevel']): string {
  switch (level) {
    case 'read_only':
      return 'Read only';
    case 'assisted':
      return 'Assisted';
    case 'governed_execution':
      return 'Governed execution';
  }
}

/** Maps a run/outcome status to a badge tone. */
function statusTone(
  status: string,
): 'success' | 'warning' | 'danger' | 'ai' | 'primary' | undefined {
  if (status === 'completed') {
    return 'success';
  }
  if (status === 'blocked' || status === 'pending') {
    return 'warning';
  }
  if (status === 'failed' || status === 'rejected') {
    return 'danger';
  }
  return undefined;
}
