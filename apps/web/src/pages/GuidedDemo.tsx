/**
 * @nexora/app-web — Guided Demo.
 *
 * A presentation layer over the REAL product — never a second execution
 * system. Every button here calls the same endpoints the normal pages call
 * (`/api/ai/chat`, the approval decision route, the finance decision route),
 * and every stage is derived from facts read back from the backend
 * (`demo/facts.ts` → `demo/journey.ts`). A click never advances a stage; only
 * a persisted fact does, and the honest non-success states are shown as such.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { Badge, Button, Card, Spinner, Stack, typography } from '@nexora/design-system';

import { AppShell } from '../components/AppShell.js';
import { ErrorState } from '../components/ErrorState.js';
import { LoadingScreen } from '../components/LoadingScreen.js';
import { useDemo } from '../demo/demo-state.js';
import { findDemoBudget, loadFacts, scopesOf, type DemoScopes } from '../demo/facts.js';
import { loadGuidedRun, saveGuidedRun, type GuidedRun } from '../demo/guided-store.js';
import {
  currentStageIndex,
  deriveStages,
  EMPTY_FACTS,
  isStoryPersona,
  mergeFacts,
  type JourneyFacts,
  type PersonaKey,
  type SelfApprovalAttempt,
  type Stage,
} from '../demo/journey.js';
import { extractEmployeeName } from '../demo/facts.js';
import { api, ApiError } from '../lib/api.js';
import { decideApproval, streamChat, type ChatDone } from '../lib/chat.js';
import type { DemoConfig, DemoPersona } from '../lib/demo.js';
import type { DashboardResponse } from '../lib/types.js';
import { useSession } from '../session.js';

const PERSONA_LABEL: Record<PersonaKey, string> = {
  ceo: 'CEO',
  manager: 'Team Manager',
  controller: 'Finance Controller',
  cfo: 'CFO',
};

/** How often the page re-reads the backend while the story is in motion. */
const POLL_MS = 5000;

/** The Guided Demo page. */
export function GuidedDemo(): JSX.Element {
  const demo = useDemo();
  const { data: session } = useSession();

  if (demo.status === 'loading') return <LoadingScreen />;
  if (demo.status === 'disabled' || demo.config === null) return <Navigate to="/demo" replace />;
  const scopes = scopesOf(demo.config);
  if (scopes === null) {
    return <ErrorState message="The demo configuration is incomplete." />;
  }
  if (session === null) return <LoadingScreen />;
  if (demo.persona === null) {
    return (
      <NotAPersona
        config={demo.config}
        busy={demo.busy}
        onSwitch={(key) => void demo.switchPersona(key)}
      />
    );
  }
  if (!isStoryPersona(demo.persona.key)) {
    return (
      <NotInStory
        config={demo.config}
        persona={demo.persona}
        busy={demo.busy}
        onSwitch={(key) => void demo.switchPersona(key)}
      />
    );
  }
  return (
    <GuidedDemoLoaded
      config={demo.config}
      scopes={scopes}
      persona={demo.persona}
      personaKey={demo.persona.key}
    />
  );
}

/** Shown to an office member who does not act in the guided story (CTO, HR, developers). */
function NotInStory({
  config,
  persona,
  busy,
  onSwitch,
}: {
  config: DemoConfig;
  persona: DemoPersona;
  busy: boolean;
  onSwitch: (key: DemoPersona['key']) => void;
}): JSX.Element {
  return (
    <div style={{ display: 'grid', placeItems: 'center', padding: 24 }} data-testid="not-in-story">
      <Card padding={8} elevationLevel="md" style={{ maxWidth: 600 }}>
        <Stack gap={4}>
          <h1 style={{ fontSize: typography.sizes['2xl'], fontWeight: typography.weights.bold }}>
            {persona.displayName} is not part of this guided story
          </h1>
          <p style={{ color: 'var(--nexora-textSecondary)' }}>
            You are signed in as the {persona.title}. The guided story is played by the CEO, the
            Team Manager, the Finance Controller and the CFO. Use the menu to explore what the{' '}
            {persona.title} can see and do, or switch to one of the story&rsquo;s people.
          </p>
          <Stack direction="row" gap={2} style={{ flexWrap: 'wrap' }}>
            {config.personas
              .filter((candidate) => isStoryPersona(candidate.key))
              .map((candidate) => (
                <Button
                  key={candidate.key}
                  size="sm"
                  variant="secondary"
                  disabled={busy}
                  onClick={() => onSwitch(candidate.key)}
                >
                  {candidate.displayName} · {candidate.title}
                </Button>
              ))}
          </Stack>
        </Stack>
      </Card>
    </div>
  );
}

function NotAPersona({
  config,
  busy,
  onSwitch,
}: {
  config: DemoConfig;
  busy: boolean;
  onSwitch: (key: DemoPersona['key']) => void;
}): JSX.Element {
  return (
    <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: 24 }}>
      <Card padding={8} elevationLevel="md" style={{ maxWidth: 560 }}>
        <Stack gap={4}>
          <h1 style={{ fontSize: typography.sizes['2xl'], fontWeight: typography.weights.bold }}>
            Sign in as a demo persona
          </h1>
          <p style={{ color: 'var(--nexora-textSecondary)' }}>
            Your current session is not one of the demo personas. Pick one — a real session is
            started for that seeded account.
          </p>
          <Stack direction="row" gap={2} style={{ flexWrap: 'wrap' }}>
            {config.personas.map((persona) => (
              <Button
                key={persona.key}
                size="sm"
                variant="secondary"
                disabled={busy}
                onClick={() => onSwitch(persona.key)}
              >
                {persona.displayName} · {persona.title}
              </Button>
            ))}
          </Stack>
        </Stack>
      </Card>
    </div>
  );
}

interface LoadedProps {
  config: DemoConfig;
  scopes: DemoScopes;
  persona: DemoPersona;
  /** The persona's key, narrowed to the people who act in the story. */
  personaKey: PersonaKey;
}

/** A live transcript of the run currently streaming from the backend. */
interface Transcript {
  title: string;
  text: string;
  done?: ChatDone;
  error?: string;
}

function GuidedDemoLoaded({ config, scopes, persona, personaKey }: LoadedProps): JSX.Element {
  const demo = useDemo();
  // The persona's own (server-published) workspace is the shell's scope; the
  // URL's workspaceId is not consulted (the backend validates scope anyway).
  const workspaceId = persona.workspaceId;
  const [dashboard, setDashboard] = useState<DashboardResponse | null>(null);
  const [dashboardError, setDashboardError] = useState<string | null>(null);
  const [facts, setFacts] = useState<JourneyFacts>(() =>
    EMPTY_FACTS(extractEmployeeName(config.story.hireRequest)),
  );
  const [factsLoaded, setFactsLoaded] = useState(false);
  const [transcript, setTranscript] = useState<Transcript | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [acting, setActing] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const refreshing = useRef(false);

  useEffect(() => {
    let cancelled = false;
    void api<DashboardResponse>(
      `/dashboard?organizationId=${encodeURIComponent(scopes.organizationId)}&workspaceId=${encodeURIComponent(workspaceId)}`,
    )
      .then((loaded) => {
        if (!cancelled) setDashboard(loaded);
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setDashboardError(
            error instanceof ApiError ? error.message : 'Could not load the workspace.',
          );
        }
      });
    return () => {
      cancelled = true;
    };
  }, [scopes.organizationId, workspaceId]);

  const refresh = useCallback(async () => {
    if (refreshing.current) return;
    refreshing.current = true;
    try {
      const loaded = await loadFacts(config, scopes, personaKey, loadGuidedRun());
      const merged = mergeFacts(loadGuidedRun().facts, loaded);
      saveGuidedRun({ facts: merged });
      setFacts(merged);
      setFactsLoaded(true);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'Could not read the demo state.');
    } finally {
      refreshing.current = false;
    }
  }, [config, scopes, personaKey]);

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => void refresh(), POLL_MS);
    return () => window.clearInterval(timer);
  }, [refresh]);

  const stages = useMemo(() => deriveStages(facts, personaKey), [facts, personaKey]);
  const current = currentStageIndex(stages);
  const shown =
    stages[selectedIndex ?? (current === -1 ? stages.length - 1 : current)] ?? stages[0]!;

  const handlers = (title: string) => ({
    onMeta: () => setTranscript({ title, text: '' }),
    onDelta: (chunk: string) =>
      setTranscript((t) => (t === null ? { title, text: chunk } : { ...t, text: t.text + chunk })),
    onDone: (done: ChatDone) => setTranscript((t) => ({ title, text: t?.text ?? '', done })),
    onError: (error: Error) =>
      setTranscript((t) => ({ title, text: t?.text ?? '', error: error.message })),
  });

  const runAction = async (work: () => Promise<void>): Promise<void> => {
    setActing(true);
    setActionError(null);
    try {
      await work();
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'The action failed.');
    } finally {
      setActing(false);
      await refresh();
    }
  };

  const sendHireRequest = () =>
    runAction(async () => {
      let captured: ChatDone | undefined;
      const h = handlers('CEO → Nexora');
      await streamChat(
        {
          message: config.story.hireRequest,
          organizationId: scopes.organizationId,
          workspaceId: scopes.engineeringWorkspaceId,
        },
        {
          ...h,
          onDone: (done) => {
            captured = done;
            h.onDone(done);
          },
        },
      );
      const id = captured?.approvals[0]?.id;
      if (id !== undefined) saveGuidedRun({ hireApprovalId: id });
    });

  /** The CEO (or Controller) really tries to approve their own request; the backend's answer is recorded as-is. */
  const attemptSelfApproval = (
    approvalId: string,
    key: 'hireSelfApproval' | 'financeSelfApproval',
  ) =>
    runAction(async () => {
      let attempt: SelfApprovalAttempt | undefined;
      await decideApproval(approvalId, 'approve', {
        onError: (error) => {
          attempt =
            error instanceof ApiError
              ? { httpStatus: error.status, code: error.code, message: error.message }
              : { httpStatus: 0, code: 'NETWORK_ERROR', message: error.message };
        },
        onDone: () => {
          attempt = {
            httpStatus: 200,
            code: 'UNEXPECTEDLY_ALLOWED',
            message: 'The backend allowed it.',
          };
        },
      });
      if (attempt !== undefined) saveGuidedRun({ [key]: attempt } as Partial<GuidedRun>);
    });

  const decide = (approvalId: string, decision: 'approve' | 'reject', title: string) =>
    runAction(async () => {
      await decideApproval(approvalId, decision, handlers(title));
    });

  const submitExpense = () =>
    runAction(async () => {
      const budget = await findDemoBudget(scopes, config.story.budgetName);
      if (budget === undefined)
        throw new Error('The demo budget could not be read from the backend.');
      const { amountMinorUnits, currency, description } = config.story.expense;
      const amount = (amountMinorUnits / 100).toLocaleString('en-US');
      let captured: ChatDone | undefined;
      const h = handlers('Finance Controller → Nexora');
      await streamChat(
        {
          message: `Submit an expense of ${amount} ${currency} for ${description} against budget ${budget.id}`,
          organizationId: scopes.organizationId,
          workspaceId: scopes.financeWorkspaceId,
        },
        {
          ...h,
          onDone: (done) => {
            captured = done;
            h.onDone(done);
          },
        },
      );
      const id = captured?.approvals[0]?.id;
      if (id !== undefined) saveGuidedRun({ financeApprovalId: id });
    });

  const decideExpense = (expenseId: string, decision: 'approve' | 'reject') =>
    runAction(async () => {
      await api(`/finance/expenses/${encodeURIComponent(expenseId)}/decide`, {
        method: 'POST',
        body: JSON.stringify({
          organizationId: scopes.organizationId,
          workspaceId: scopes.financeWorkspaceId,
          decision,
        }),
      });
    });

  if (dashboardError !== null) return <ErrorState message={dashboardError} />;
  if (dashboard === null || dashboard.organization === null) return <LoadingScreen />;

  const scopeQuery = (ws: string) =>
    `?organizationId=${encodeURIComponent(scopes.organizationId)}&workspaceId=${encodeURIComponent(ws)}`;
  const hireApproval = facts.hire.approval?.value;
  const finApproval = facts.finance.approval?.value;
  const expense = facts.finance.expense?.value;

  /** The real action(s) the CURRENT persona can take in the shown stage. */
  const actions = (): JSX.Element | null => {
    const busy = acting || demo.busy;
    switch (shown.id) {
      case 'ceo-request':
        return personaKey === 'ceo' && hireApproval === undefined ? (
          <Button onClick={() => void sendHireRequest()} loading={busy} disabled={busy}>
            Send: “{config.story.hireRequest}”
          </Button>
        ) : null;
      case 'approval-required':
        return personaKey === 'ceo' &&
          hireApproval?.status === 'awaiting_approval' &&
          facts.hire.selfApproval === undefined ? (
          <Button
            variant="secondary"
            onClick={() => void attemptSelfApproval(hireApproval.id, 'hireSelfApproval')}
            loading={busy}
            disabled={busy}
          >
            Try to approve my own request
          </Button>
        ) : null;
      case 'manager-approval':
        return personaKey === 'manager' && hireApproval?.status === 'awaiting_approval' ? (
          <Stack direction="row" gap={2}>
            <Button
              onClick={() =>
                void decide(hireApproval.id, 'approve', 'Team Manager approves → execution')
              }
              loading={busy}
              disabled={busy || !hireApproval.canDecide}
            >
              Approve the hire
            </Button>
            <Button
              variant="danger"
              onClick={() => void decide(hireApproval.id, 'reject', 'Team Manager rejects')}
              disabled={busy || !hireApproval.canDecide}
            >
              Reject
            </Button>
          </Stack>
        ) : null;
      case 'manager-views-project':
        return (
          <Link
            to={`/app/projects${scopeQuery(scopes.engineeringWorkspaceId)}`}
            style={{ textDecoration: 'none' }}
          >
            <Button variant="secondary">Open Projects → {config.story.projectName}</Button>
          </Link>
        );
      case 'expense-submitted':
        return personaKey === 'controller' && finApproval === undefined && expense === undefined ? (
          <Button onClick={() => void submitExpense()} loading={busy} disabled={busy}>
            Submit the expense for approval
          </Button>
        ) : null;
      case 'cfo-approval':
        if (finApproval?.status !== 'awaiting_approval') return null;
        if (personaKey === 'cfo') {
          return (
            <Stack direction="row" gap={2}>
              <Button
                onClick={() =>
                  void decide(
                    finApproval.id,
                    'approve',
                    'CFO approves the submission → expense recorded',
                  )
                }
                loading={busy}
                disabled={busy || !finApproval.canDecide}
              >
                Approve the submission
              </Button>
              <Button
                variant="danger"
                onClick={() => void decide(finApproval.id, 'reject', 'CFO rejects')}
                disabled={busy || !finApproval.canDecide}
              >
                Reject
              </Button>
            </Stack>
          );
        }
        return personaKey === 'controller' && facts.finance.selfApproval === undefined ? (
          <Button
            variant="secondary"
            onClick={() => void attemptSelfApproval(finApproval.id, 'financeSelfApproval')}
            loading={busy}
            disabled={busy}
          >
            Try to approve my own submission
          </Button>
        ) : null;
      case 'finance-decision':
        return personaKey === 'cfo' && expense?.status === 'pending' ? (
          <Stack direction="row" gap={2}>
            <Button
              onClick={() => void decideExpense(expense.id, 'approve')}
              loading={busy}
              disabled={busy}
            >
              Approve the expense
            </Button>
            <Button
              variant="danger"
              onClick={() => void decideExpense(expense.id, 'reject')}
              disabled={busy}
            >
              Reject
            </Button>
          </Stack>
        ) : null;
      case 'decision-trace':
        return hireApproval === undefined ? null : (
          <Link
            to={`/app/audit${scopeQuery(scopes.engineeringWorkspaceId)}&event=${encodeURIComponent(`apr:${hireApproval.id}`)}`}
            style={{ textDecoration: 'none' }}
          >
            <Button variant="secondary">Open the Decision Trace</Button>
          </Link>
        );
      case 'audit':
        return (
          <Link
            to={`/app/audit${scopeQuery(scopes.engineeringWorkspaceId)}`}
            style={{ textDecoration: 'none' }}
          >
            <Button variant="secondary">Open the Audit Center</Button>
          </Link>
        );
      case 'runtime':
        return (
          <Link
            to={`/app/runtime${scopeQuery(scopes.engineeringWorkspaceId)}`}
            style={{ textDecoration: 'none' }}
          >
            <Button variant="secondary">Open Runtime Runs</Button>
          </Link>
        );
      default:
        return null;
    }
  };

  const neededPersona: PersonaKey | undefined =
    shown.status === 'done' || shown.actor === 'system' || shown.actor === personaKey
      ? shown.waitingFor !== undefined && shown.waitingFor !== personaKey
        ? shown.waitingFor
        : undefined
      : shown.actor;

  return (
    <AppShell
      user={dashboard.user}
      organizationName={dashboard.organization.name}
      workspaceName={dashboard.workspace?.name ?? persona.title}
      organizationId={scopes.organizationId}
      workspaceId={workspaceId}
    >
      <Stack gap={6} style={{ maxWidth: 1240, margin: '0 auto' }} data-testid="guided-demo">
        <Stack
          direction="row"
          gap={4}
          align="center"
          justify="space-between"
          style={{ flexWrap: 'wrap' }}
        >
          <Stack gap={1}>
            <Badge tone="ai" dot>
              Guided demo
            </Badge>
            <h1 className="nexora-page-title">
              Request → Plan → Governance → Approval → Execution → Verification → Trace
            </h1>
            <p style={{ fontSize: typography.sizes.sm, color: 'var(--nexora-textSecondary)' }}>
              Signed in as <strong>{persona.displayName}</strong> · {persona.title}. Every stage
              below is read back from Nexora — nothing here is assumed.
            </p>
          </Stack>
          <Stack direction="row" gap={2} align="center">
            {!factsLoaded ? <Spinner size={14} /> : null}
            <Link
              to={`/app/command-center${scopeQuery(workspaceId)}`}
              style={{ textDecoration: 'none' }}
            >
              <Button variant="ghost" size="sm">
                Explore the product
              </Button>
            </Link>
            <Button
              variant="secondary"
              size="sm"
              disabled={demo.busy}
              onClick={() => {
                if (
                  window.confirm(
                    'Reset the demo organization to its seed? Demo history is cleared.',
                  )
                ) {
                  void demo.reset().then(() => {
                    setTranscript(null);
                    setSelectedIndex(null);
                    void refresh();
                  });
                }
              }}
            >
              Reset demo
            </Button>
          </Stack>
        </Stack>

        <div className="nexora-demo-grid">
          <Card padding={4}>
            <ol style={{ listStyle: 'none', margin: 0, padding: 0 }} aria-label="Demo stages">
              {stages.map((stage, index) => (
                <li key={stage.id}>
                  <button
                    type="button"
                    onClick={() => setSelectedIndex(index)}
                    aria-current={index === current ? 'step' : undefined}
                    className={`nexora-demo-stage${stage === shown ? ' nexora-demo-stage-selected' : ''}`}
                  >
                    <StageDot status={stage.status} />
                    <span style={{ flex: 1, minWidth: 0 }}>
                      <span
                        style={{
                          display: 'block',
                          fontSize: typography.sizes.sm,
                          fontWeight:
                            index === current
                              ? typography.weights.semibold
                              : typography.weights.medium,
                        }}
                      >
                        {index + 1}. {stage.title}
                      </span>
                      <span
                        style={{
                          display: 'block',
                          fontSize: typography.sizes.xs,
                          color: 'var(--nexora-textMuted)',
                        }}
                      >
                        {stage.actor === 'system' ? 'Nexora' : PERSONA_LABEL[stage.actor]}
                      </span>
                    </span>
                    <StatusBadge status={stage.status} />
                  </button>
                </li>
              ))}
            </ol>
          </Card>

          <Stack gap={4}>
            <Card padding={6} elevationLevel="md">
              <Stack gap={4}>
                <Stack
                  direction="row"
                  gap={3}
                  align="center"
                  justify="space-between"
                  style={{ flexWrap: 'wrap' }}
                >
                  <Stack gap={1}>
                    <div
                      style={{
                        fontSize: typography.sizes.xs,
                        color: 'var(--nexora-textMuted)',
                      }}
                    >
                      Stage {shown.index} of {stages.length}
                    </div>
                    <h2
                      style={{
                        fontSize: typography.sizes['2xl'],
                        fontWeight: typography.weights.bold,
                        letterSpacing: '-0.02em',
                      }}
                    >
                      {shown.title}
                    </h2>
                  </Stack>
                  <StatusBadge status={shown.status} large />
                </Stack>
                <p style={{ fontSize: typography.sizes.md }}>{shown.headline}</p>
                {shown.caution !== undefined ? (
                  <div
                    style={{
                      padding: '10px 12px',
                      borderRadius: 8,
                      background: 'var(--nexora-warningSoft)',
                      color: 'var(--nexora-text)',
                      fontSize: typography.sizes.sm,
                    }}
                  >
                    {shown.caution}
                  </div>
                ) : null}
                {shown.evidence.length > 0 ? (
                  <Stack gap={1}>
                    <div
                      style={{ fontSize: typography.sizes.xs, color: 'var(--nexora-textMuted)' }}
                    >
                      What the backend recorded
                    </div>
                    <ul style={{ margin: 0, paddingLeft: 18, fontSize: typography.sizes.sm }}>
                      {shown.evidence.map((line) => (
                        <li key={line}>{line}</li>
                      ))}
                    </ul>
                  </Stack>
                ) : null}
                <Stack direction="row" gap={2} align="center" style={{ flexWrap: 'wrap' }}>
                  {actions()}
                  {neededPersona !== undefined ? (
                    <Button
                      variant="secondary"
                      disabled={demo.busy}
                      onClick={() => void demo.switchPersona(neededPersona)}
                    >
                      Switch to the {PERSONA_LABEL[neededPersona]}
                    </Button>
                  ) : null}
                </Stack>
                {actionError !== null ? (
                  <p
                    role="alert"
                    style={{ color: 'var(--nexora-danger)', fontSize: typography.sizes.sm }}
                  >
                    {actionError}
                  </p>
                ) : null}
              </Stack>
            </Card>

            {transcript !== null ? (
              <Card padding={5}>
                <Stack gap={2}>
                  <div style={{ fontSize: typography.sizes.xs, color: 'var(--nexora-textMuted)' }}>
                    {transcript.title}
                  </div>
                  <pre
                    style={{
                      margin: 0,
                      whiteSpace: 'pre-wrap',
                      fontFamily: 'inherit',
                      fontSize: typography.sizes.sm,
                    }}
                  >
                    {transcript.text.length === 0 &&
                    transcript.done === undefined &&
                    transcript.error === undefined
                      ? '…'
                      : transcript.text}
                  </pre>
                  {transcript.done !== undefined ? (
                    <Stack direction="row" gap={2} style={{ flexWrap: 'wrap' }}>
                      <Badge
                        tone={
                          transcript.done.status === 'blocked'
                            ? 'warning'
                            : transcript.done.status === 'completed'
                              ? 'success'
                              : 'neutral'
                        }
                      >
                        run {transcript.done.status}
                      </Badge>
                      {transcript.done.approvals.map((approval) => (
                        <Badge key={approval.stepId} tone="ai">
                          {approval.capabilityId} · approval {approval.status}
                        </Badge>
                      ))}
                    </Stack>
                  ) : null}
                  {transcript.error !== undefined ? (
                    <p
                      role="alert"
                      style={{ color: 'var(--nexora-danger)', fontSize: typography.sizes.sm }}
                    >
                      {transcript.error}
                    </p>
                  ) : null}
                </Stack>
              </Card>
            ) : null}
          </Stack>
        </div>
      </Stack>
      <style>{`
        .nexora-demo-grid { display: grid; grid-template-columns: minmax(260px, 340px) minmax(0, 1fr); gap: 16px; align-items: start; }
        @media (max-width: 900px) { .nexora-demo-grid { grid-template-columns: 1fr; } }
        .nexora-demo-stage { display: flex; align-items: center; gap: 10px; width: 100%; text-align: left; padding: 8px 10px; border: 1px solid transparent; border-radius: 8px; background: transparent; color: inherit; cursor: pointer; transition: background 160ms ease, border-color 160ms ease; }
        .nexora-demo-stage:hover { background: var(--nexora-surfaceMuted); }
        .nexora-demo-stage-selected { background: var(--nexora-primarySoft); border-color: var(--nexora-primary); }
        .nexora-demo-dot { width: 10px; height: 10px; border-radius: 999px; flex-shrink: 0; }
        .nexora-demo-dot-active { box-shadow: 0 0 0 4px var(--nexora-primarySoft); animation: nexora-demo-pulse 1.6s ease-in-out infinite; }
        @keyframes nexora-demo-pulse { 0%,100% { transform: scale(1); } 50% { transform: scale(1.25); } }
      `}</style>
    </AppShell>
  );
}

function StageDot({ status }: { status: Stage['status'] }): JSX.Element {
  const color =
    status === 'done'
      ? 'var(--nexora-success)'
      : status === 'failed'
        ? 'var(--nexora-danger)'
        : status === 'active'
          ? 'var(--nexora-primary)'
          : 'var(--nexora-borderStrong)';
  return (
    <span
      aria-hidden
      className={`nexora-demo-dot${status === 'active' ? ' nexora-demo-dot-active' : ''}`}
      style={{ background: color }}
    />
  );
}

/** The status badge of a stage (exported for tests). */
export function StatusBadge({
  status,
  large,
}: {
  status: Stage['status'];
  large?: boolean;
}): JSX.Element {
  const label =
    status === 'done'
      ? 'Done'
      : status === 'active'
        ? 'In progress'
        : status === 'failed'
          ? 'Did not complete'
          : 'Pending';
  const tone =
    status === 'done'
      ? 'success'
      : status === 'active'
        ? 'primary'
        : status === 'failed'
          ? 'danger'
          : 'neutral';
  return (
    <Badge tone={tone} dot={large === true}>
      {label}
    </Badge>
  );
}
