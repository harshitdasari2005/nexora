/**
 * @nexora/app-web — AI panel.
 *
 * The first Enterprise AI surface (FRONTEND.md §6): a right-side panel that
 * streams chat responses from `POST /api/ai/chat`. The panel renders the
 * conversation (user + assistant), auto-scrolls as tokens arrive, and
 * exposes loading, error, and empty states. State-changing intents surface
 * an **approval card** (Approve/Reject): approving resumes the gated run
 * through `POST /api/ai/approvals/:id/decision` and streams the execution;
 * rejecting records the decision with no execution.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { Button, radius, spacing, typography } from '@nexora/design-system';

import {
  decideApproval,
  streamChat,
  type ChatApproval,
  type ChatDone,
  type ChatPlanStep,
} from '../lib/chat.js';
import { humanizeIdentifier } from '../lib/humanize.js';
import { resolvePersonaForRole } from '../lib/rolePersonas.js';
import { useRoleTheme } from '../lib/RoleThemeContext.js';
import { NavIcon } from './NavIcon.js';

/** The small caps eyebrow used on the panel's inline cards. */
const CARD_EYEBROW: CSSProperties = {
  fontSize: '11px',
  fontWeight: typography.weights.semibold,
  color: 'var(--nexora-textMuted)',
};

/** A 6px status dot for a workflow step (succeeded / failed / running). */
function StepStatusDot({ status }: { status: string }): JSX.Element {
  const color =
    status === 'succeeded'
      ? 'var(--nexora-success)'
      : status === 'failed'
        ? 'var(--nexora-danger)'
        : 'var(--nexora-textMuted)';
  return (
    <span
      aria-hidden
      style={{
        width: 6,
        height: 6,
        flexShrink: 0,
        borderRadius: radius.full,
        background: color,
        animation:
          status !== 'succeeded' && status !== 'failed'
            ? 'nexora-pulse 1.4s ease-in-out infinite'
            : 'none',
      }}
    />
  );
}

/** A rendered message in the panel. */
export interface PanelMessage {
  /** Stable id. */
  id: string;
  /** The message role. */
  role: 'user' | 'assistant';
  /** The message content. */
  content: string;
}

/** Props of {@link AiPanel}. */
export interface AiPanelProps {
  /** The current organization scope (sent so the API doesn't default to the caller's first org). */
  organizationId?: string;
  /** The current workspace scope, when one is active. */
  workspaceId?: string;
  /** The current organization name (approval card context). */
  organizationName?: string;
  /** The current user's display name (approval card context). */
  userDisplayName?: string;
  /** Pre-seeded messages (used by tests and future history loading). */
  initialMessages?: readonly PanelMessage[];
}

// Curated to capabilities registered in the AI Runtime (v1: workspaces,
// projects, and the first workflow). Used only when the resolved role
// doesn't map to one of the six curated personas below — every persona
// gets its own role-specific set instead (S35).
const DEFAULT_EXAMPLE_PROMPTS = [
  'Create a project called Customer Onboarding and assign Priya to it',
  'What workspaces do I have?',
  'Create a workspace called Engineering',
];

/**
 * The dashboard AI assistant panel.
 */
export function AiPanel({
  organizationId,
  workspaceId,
  organizationName,
  userDisplayName,
  initialMessages = [],
}: AiPanelProps): JSX.Element {
  const [messages, setMessages] = useState<PanelMessage[]>(() =>
    initialMessages.map((message) => ({ ...message })),
  );
  const [streaming, setStreaming] = useState(false);
  const [streamingContent, setStreamingContent] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [pendingApproval, setPendingApproval] = useState<ChatApproval | null>(null);
  const [deciding, setDeciding] = useState(false);
  const [plan, setPlan] = useState<readonly ChatPlanStep[]>([]);
  const [workflow, setWorkflow] = useState<WorkflowTimelineData | null>(null);

  // S35: suggested prompts read the caller's real resolved role — a CFO and
  // a Developer see different starting questions for the SAME empty state,
  // never a fabricated per-role UI.
  const { current: currentRole } = useRoleTheme();
  const examplePrompts =
    resolvePersonaForRole(currentRole?.roleId)?.aiPrompts ?? DEFAULT_EXAMPLE_PROMPTS;

  const conversationIdRef = useRef<string | undefined>(undefined);
  const lastPromptRef = useRef('');
  const sendingRef = useRef(false);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const sequenceRef = useRef(0);

  // Auto-scroll only while the user is near the bottom (never yank them out
  // of history they scrolled up to read).
  useEffect(() => {
    const container = scrollRef.current;
    if (container === null) {
      return;
    }
    const nearBottom = container.scrollHeight - container.scrollTop - container.clientHeight < 80;
    if (nearBottom) {
      container.scrollTop = container.scrollHeight;
    }
  }, [messages, streamingContent, streaming, pendingApproval]);

  const nextId = useCallback(() => {
    sequenceRef.current += 1;
    return `msg_${sequenceRef.current}`;
  }, []);

  const send = useCallback(
    async (raw: string) => {
      const message = raw.trim();
      // The ref (not the state) arbitrates concurrent sends: state lags one
      // render, so two rapid Enters would both pass a state-only check.
      if (message.length === 0 || sendingRef.current) {
        return;
      }
      sendingRef.current = true;
      lastPromptRef.current = message;
      setMessages((previous) => [...previous, { id: nextId(), role: 'user', content: message }]);
      setDraft('');
      setError(null);
      setStreaming(true);
      setStreamingContent('');
      setPendingApproval(null);
      setPlan([]);
      setWorkflow(null);

      try {
        await streamChat(
          {
            message,
            organizationId,
            workspaceId,
            conversationId: conversationIdRef.current,
          },
          {
            onMeta: (meta) => {
              conversationIdRef.current = meta.conversationId;
            },
            onDone: (done: ChatDone) => {
              conversationIdRef.current = done.conversationId;
              setStreamingContent('');
              setMessages((previous) => [
                ...previous,
                { id: nextId(), role: 'assistant', content: done.response },
              ]);
              // Safe execution progress: the committed plan (plan card) and
              // the workflow journal (step timeline) — never chain-of-thought.
              setPlan(done.plan ?? []);
              setWorkflow(extractWorkflowTimeline(done.steps));
              // A gated (state-changing) step surfaces an approval request;
              // the card renders below the response until decided.
              const pending = done.approvals.find(
                (approval) => approval.status === 'pending' && approval.id !== undefined,
              );
              setPendingApproval(pending ?? null);
            },
            onError: (caught) => {
              setStreamingContent('');
              setError(caught.message);
            },
          },
        );
      } finally {
        sendingRef.current = false;
        setStreaming(false);
      }
    },
    [nextId, organizationId, workspaceId],
  );

  /** Approves the pending request: the gated run resumes and streams. */
  const approve = useCallback(async () => {
    const approval = pendingApproval;
    if (approval === null || approval.id === undefined || deciding) {
      return;
    }
    setDeciding(true);
    setError(null);
    setStreaming(true);
    setStreamingContent('');
    try {
      await decideApproval(approval.id, 'approve', {
        onDelta: (text) => {
          setStreamingContent((previous) => previous + text);
        },
        onDone: (done: ChatDone) => {
          conversationIdRef.current = done.conversationId;
          setStreamingContent('');
          setMessages((previous) => [
            ...previous,
            { id: nextId(), role: 'assistant', content: done.response },
          ]);
          setPlan(done.plan ?? []);
          setWorkflow(extractWorkflowTimeline(done.steps));
          setPendingApproval(null);
        },
        onError: (caught) => {
          setStreamingContent('');
          setError(caught.message);
        },
      });
    } finally {
      setDeciding(false);
      setStreaming(false);
    }
  }, [deciding, nextId, pendingApproval]);

  /** Rejects the pending request: the decision is recorded, nothing executes. */
  const reject = useCallback(async () => {
    const approval = pendingApproval;
    if (approval === null || approval.id === undefined || deciding) {
      return;
    }
    setDeciding(true);
    setError(null);
    try {
      const outcome = await decideApproval(approval.id, 'reject', {
        onError: (caught) => {
          setError(caught.message);
        },
      });
      if (outcome !== undefined) {
        conversationIdRef.current = outcome.conversationId;
        setMessages((previous) => [
          ...previous,
          {
            id: nextId(),
            role: 'assistant',
            content: 'Approval rejected — no changes were made.',
          },
        ]);
        setPendingApproval(null);
      }
    } finally {
      setDeciding(false);
    }
  }, [deciding, nextId, pendingApproval]);

  const hasContent = messages.length > 0 || streamingContent.length > 0;

  return (
    <div
      className="nexora-ai-panel"
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        minHeight: 0,
        background: 'var(--nexora-surface)',
        borderLeft: '1px solid var(--nexora-border)',
      }}
    >
      {/* Header */}
      <header
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: spacing[3],
          padding: `${spacing[4]} ${spacing[5]}`,
          borderBottom: '1px solid var(--nexora-border)',
        }}
      >
        <span
          aria-hidden
          style={{
            width: 28,
            height: 28,
            borderRadius: radius.md,
            background: 'var(--nexora-text)',
            color: 'var(--nexora-bg)',
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
          }}
        >
          <NavIcon name="sparkles" size={15} />
        </span>
        <div style={{ minWidth: 0 }}>
          <div
            style={{
              fontWeight: typography.weights.semibold,
              fontSize: typography.sizes.sm,
              letterSpacing: '-0.01em',
            }}
          >
            Nexora AI
          </div>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: spacing[1.5],
              fontSize: typography.sizes.xs,
              color: streaming ? 'var(--nexora-ai)' : 'var(--nexora-textMuted)',
            }}
          >
            <span
              aria-hidden
              style={{
                width: 6,
                height: 6,
                borderRadius: radius.full,
                background: streaming ? 'var(--nexora-ai)' : 'var(--nexora-textMuted)',
                animation: streaming ? 'nexora-pulse 1.4s ease-in-out infinite' : 'none',
              }}
            />
            {streaming ? 'Working…' : 'Enterprise AI'}
          </div>
        </div>
      </header>

      {/* Messages */}
      <div
        ref={scrollRef}
        role="log"
        aria-live="polite"
        aria-label="AI conversation"
        style={{
          flex: 1,
          minHeight: 0,
          overflowY: 'auto',
          padding: spacing[5],
          display: 'flex',
          flexDirection: 'column',
          gap: spacing[4],
        }}
      >
        {!hasContent ? (
          <EmptyConversation prompts={examplePrompts} onPick={(prompt) => void send(prompt)} />
        ) : (
          <>
            {messages.map((message) => (
              <MessageBubble key={message.id} message={message} />
            ))}
            {streaming ? (
              <MessageBubble
                message={{ id: 'streaming', role: 'assistant', content: streamingContent }}
                streaming
              />
            ) : null}
            {plan.length > 0 && !streaming ? (
              <PlanCard
                plan={plan}
                workflow={workflow}
                awaitingApproval={pendingApproval !== null}
              />
            ) : null}
            {workflow !== null ? <WorkflowTimeline data={workflow} /> : null}
            {pendingApproval !== null && (deciding || !streaming) ? (
              <ApprovalCard
                approval={pendingApproval}
                organizationName={organizationName}
                userDisplayName={userDisplayName}
                deciding={deciding}
                onApprove={() => void approve()}
                onReject={() => void reject()}
              />
            ) : null}
          </>
        )}
      </div>

      {/* Error banner */}
      {error !== null ? (
        <div
          role="alert"
          style={{
            margin: `0 ${spacing[4]} ${spacing[3]}`,
            padding: `${spacing[3]} ${spacing[4]}`,
            background: 'var(--nexora-dangerSoft)',
            border: '1px solid var(--nexora-danger)',
            borderRadius: radius.md,
            fontSize: typography.sizes.sm,
            color: 'var(--nexora-danger)',
          }}
        >
          <div style={{ fontWeight: typography.weights.semibold }}>The AI could not respond</div>
          <div style={{ marginTop: 2 }}>{error}</div>
          <button
            type="button"
            onClick={() => {
              setError(null);
              setMessages((previous) => previous.slice(0, -1));
              void send(lastPromptRef.current);
            }}
            style={{
              marginTop: spacing[2],
              padding: 0,
              border: 'none',
              background: 'none',
              color: 'var(--nexora-danger)',
              fontSize: typography.sizes.xs,
              fontWeight: typography.weights.semibold,
              cursor: 'pointer',
              textDecoration: 'underline',
            }}
          >
            Retry
          </button>
        </div>
      ) : null}

      {/* Composer */}
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void send(draft);
        }}
        style={{
          display: 'flex',
          alignItems: 'flex-end',
          gap: spacing[2],
          padding: spacing[4],
          borderTop: '1px solid var(--nexora-border)',
        }}
      >
        <textarea
          id="nexora-ai-input"
          name="message"
          className="nexora-input"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault();
              void send(draft);
            }
          }}
          placeholder="Ask Nexora anything…"
          aria-label="Message the AI"
          disabled={streaming}
          rows={1}
          style={{
            flex: 1,
            resize: 'none',
            minHeight: 36,
            maxHeight: 120,
            padding: '8px 12px',
            background: 'var(--nexora-surface)',
            border: '1px solid var(--nexora-borderStrong)',
            borderRadius: radius.md,
            fontSize: typography.sizes.sm,
            color: 'var(--nexora-text)',
            outline: 'none',
            transition: 'border-color 140ms ease, box-shadow 140ms ease',
          }}
        />
        <Button type="submit" disabled={streaming || draft.trim().length === 0} size="sm">
          {streaming ? '…' : 'Send'}
        </Button>
      </form>

      <style>{`
        @media (max-width: 1100px) {
          .nexora-ai-panel { display: none; }
        }
      `}</style>
    </div>
  );
}

/** A single conversation bubble (user right, assistant left). */
function MessageBubble({
  message,
  streaming = false,
}: {
  message: PanelMessage;
  streaming?: boolean;
}): JSX.Element {
  const isUser = message.role === 'user';
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: isUser ? 'flex-end' : 'flex-start',
      }}
    >
      {!isUser ? (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: spacing[2],
            marginBottom: spacing[1.5],
          }}
        >
          <span
            aria-hidden
            style={{
              width: 20,
              height: 20,
              borderRadius: radius.sm,
              background: 'var(--nexora-text)',
              color: 'var(--nexora-bg)',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
            }}
          >
            <NavIcon name="sparkles" size={12} />
          </span>
          <span
            style={{
              fontSize: '11px',
              fontWeight: typography.weights.semibold,
              color: 'var(--nexora-textMuted)',
            }}
          >
            Nexora AI
          </span>
        </div>
      ) : null}
      <div
        style={{
          maxWidth: '88%',
          padding: `${spacing[2.5]} ${spacing[3]}`,
          borderRadius: radius.lg,
          borderBottomRightRadius: isUser ? radius.sm : radius.lg,
          borderBottomLeftRadius: isUser ? radius.lg : radius.sm,
          background: isUser ? 'var(--nexora-primary)' : 'var(--nexora-surfaceMuted)',
          color: isUser ? 'var(--nexora-primaryForeground)' : 'var(--nexora-text)',
          fontSize: typography.sizes.sm,
          lineHeight: typography.lineHeights.relaxed,
          whiteSpace: 'pre-wrap',
          overflowWrap: 'anywhere',
        }}
      >
        {message.content}
        {streaming ? <StreamingCursor /> : null}
      </div>
    </div>
  );
}

/** The blinking cursor shown while tokens are still arriving. */
function StreamingCursor(): JSX.Element {
  return (
    <span
      aria-hidden
      style={{
        display: 'inline-block',
        width: 7,
        height: 14,
        marginLeft: 3,
        verticalAlign: 'text-bottom',
        background: 'var(--nexora-ai)',
        borderRadius: 1,
        animation: 'nexora-blink 1.1s ease infinite',
      }}
    />
  );
}

/** Props of {@link ApprovalCard}. */
export interface ApprovalCardProps {
  /** The pending approval request. */
  approval: ChatApproval;
  /** The current organization name. */
  organizationName?: string;
  /** The current user's display name. */
  userDisplayName?: string;
  /** Whether a decision is in flight (buttons disabled). */
  deciding: boolean;
  /** Approve handler. */
  onApprove: () => void;
  /** Reject handler. */
  onReject: () => void;
}

/**
 * The human-approval card for a state-changing AI action (FRONTEND.md §6
 * approval requests). Shows what will change, who requested it, and the
 * risk, with Approve/Reject actions. Never exposes internal security ids.
 */
export function ApprovalCard({
  approval,
  organizationName,
  userDisplayName,
  deciding,
  onApprove,
  onReject,
}: ApprovalCardProps): JSX.Element {
  const action = humanizeAction(approval.toolId);
  const name = typeof approval.input?.name === 'string' ? approval.input.name : undefined;
  const risk =
    approval.sideEffectClass === 'consequential' ? 'Persistent state change' : 'State change';
  // S34 RBAC: presentation-only — the decision route re-checks the SAME
  // `approvals.decide` permission regardless of what renders here.
  const { current } = useRoleTheme();
  const canDecide = current?.permissions.includes('approvals.decide') ?? false;
  return (
    <div
      role="group"
      aria-label="Approval required"
      style={{
        alignSelf: 'center',
        width: '100%',
        maxWidth: 320,
        border: '1px solid var(--nexora-borderStrong)',
        borderRadius: radius.lg,
        background: 'var(--nexora-surface)',
        padding: spacing[4],
        display: 'flex',
        flexDirection: 'column',
        gap: spacing[3],
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: spacing[2.5] }}>
        <span
          aria-hidden
          style={{
            width: 26,
            height: 26,
            borderRadius: radius.md,
            background: 'var(--nexora-warningSoft)',
            color: 'var(--nexora-warning)',
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
          }}
        >
          <NavIcon name="problems" size={14} />
        </span>
        <div>
          <div style={{ ...CARD_EYEBROW, color: 'var(--nexora-warning)' }}>Approval required</div>
          <div
            style={{
              fontSize: typography.sizes.sm,
              fontWeight: typography.weights.medium,
              marginTop: 1,
            }}
          >
            {action}
          </div>
        </div>
      </div>

      <dl style={{ margin: 0, display: 'flex', flexDirection: 'column', gap: spacing[1.5] }}>
        {name !== undefined ? <ApprovalRow label="Name" value={name} /> : null}
        {typeof approval.input?.projectName === 'string' ? (
          <ApprovalRow label="Project" value={approval.input.projectName} />
        ) : null}
        {typeof approval.input?.employeeName === 'string' ? (
          <ApprovalRow label="Employee" value={approval.input.employeeName} />
        ) : null}
        <ApprovalRow label="Organization" value={organizationName ?? 'Current organization'} />
        <ApprovalRow label="Requested by" value={userDisplayName ?? 'You'} />
        <ApprovalRow label="Risk" value={risk} />
        {approval.expiresAt !== undefined ? (
          <ApprovalRow label="Expires" value={new Date(approval.expiresAt).toLocaleString()} />
        ) : null}
        {approval.requiredApproverRoleId !== undefined ? (
          <ApprovalRow label="Required approver" value={approval.requiredApproverRoleId} />
        ) : null}
        {approval.separationOfDuties === true ? (
          <ApprovalRow label="Separation of duties" value="Requester cannot approve" />
        ) : null}
      </dl>

      {canDecide ? (
        <div style={{ display: 'flex', gap: spacing[2] }}>
          <Button size="sm" onClick={onApprove} disabled={deciding}>
            {deciding ? 'Submitting…' : 'Approve'}
          </Button>
          <Button size="sm" variant="secondary" onClick={onReject} disabled={deciding}>
            Reject
          </Button>
        </div>
      ) : (
        <div style={{ fontSize: typography.sizes.xs, color: 'var(--nexora-textMuted)' }}>
          Your current role does not have permission to decide this approval.
        </div>
      )}
    </div>
  );
}

/** A single key/value row of the approval card. */
function ApprovalRow({ label, value }: { label: string; value: string }): JSX.Element {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: spacing[3] }}>
      <dt style={{ fontSize: typography.sizes.xs, color: 'var(--nexora-textMuted)' }}>{label}</dt>
      <dd
        style={{
          margin: 0,
          fontSize: typography.sizes.xs,
          fontWeight: typography.weights.medium,
          textAlign: 'right',
          overflowWrap: 'anywhere',
        }}
      >
        {value}
      </dd>
    </div>
  );
}

/**
 * Humanizes a tool id (`workspaces.create_workspace` → `Create Workspace`).
 * Re-exported here (in addition to `../lib/humanize.js`) since it's part of
 * this module's existing tested public surface — same shared implementation.
 */
export function humanizeAction(toolId: string): string {
  return humanizeIdentifier(toolId);
}

/** The workflow journal rendered as a timeline (safe display data only). */
export interface WorkflowTimelineData {
  /** The workflow instance id. */
  id: string;
  /** The final instance status. */
  status: string;
  /** The step journal. */
  steps: readonly { stepId: string; name: string; status: string }[];
}

/** Extracts a workflow journal from the executed step outputs, if present. */
export function extractWorkflowTimeline(
  steps: readonly { status: string; output?: unknown }[],
): WorkflowTimelineData | null {
  for (const step of steps) {
    const output = step.output as { workflow?: WorkflowTimelineData } | undefined;
    if (output?.workflow !== undefined) {
      return output.workflow;
    }
  }
  return null;
}

/** The plan card shown before approval: numbered, safe execution steps. */
export function PlanCard({
  plan,
  workflow,
  awaitingApproval,
}: {
  plan: readonly ChatPlanStep[];
  workflow: WorkflowTimelineData | null;
  awaitingApproval: boolean;
}): JSX.Element {
  const rows = plan.flatMap((step, index) => {
    const input = step.input ?? {};
    // A workflow step expands into its deterministic display steps; other
    // steps render one row with their bound user-controlled values.
    if (step.workflowSteps !== undefined && step.workflowSteps.length > 0) {
      return step.workflowSteps.map((workflowStep, subIndex) => ({
        index: index + subIndex + 1,
        label: workflowStep.name,
        detail: detailFor(workflowStep.capabilityId, input),
        capabilityId: workflowStep.capabilityId,
      }));
    }
    return [
      {
        index: index + 1,
        label: humanizeAction(step.capabilityId),
        detail: detailFor(step.capabilityId, input),
        capabilityId: step.capabilityId,
      },
    ];
  });

  return (
    <div
      role="group"
      aria-label="Plan"
      style={{
        alignSelf: 'center',
        width: '100%',
        maxWidth: 360,
        border: '1px solid var(--nexora-border)',
        borderRadius: radius.lg,
        background: 'var(--nexora-surface)',
        padding: spacing[4],
        display: 'flex',
        flexDirection: 'column',
        gap: spacing[2],
      }}
    >
      <div style={CARD_EYEBROW}>Plan</div>
      {rows.map((row) => (
        <div key={`${row.capabilityId}-${row.index}`} style={{ display: 'flex', gap: spacing[2] }}>
          <span
            style={{
              fontSize: typography.sizes.xs,
              color: 'var(--nexora-textMuted)',
              width: 18,
              flexShrink: 0,
              textAlign: 'right',
            }}
          >
            {row.index}.
          </span>
          <span style={{ fontSize: typography.sizes.sm }}>
            {row.label}
            {row.detail.length > 0 ? (
              <span style={{ color: 'var(--nexora-textMuted)' }}> — {row.detail}</span>
            ) : null}
          </span>
        </div>
      ))}
      {workflow !== null ? (
        <div
          style={{
            marginTop: spacing[1],
            fontSize: typography.sizes.xs,
            color: 'var(--nexora-textMuted)',
          }}
        >
          {awaitingApproval
            ? 'Approval required before anything executes.'
            : 'This plan was executed as a workflow.'}
        </div>
      ) : null}
    </div>
  );
}

/** The bound user-controlled value shown next to a plan step (if any). */
function detailFor(capabilityId: string, input: Record<string, unknown>): string {
  if (capabilityId === 'projects.create_project') {
    return typeof input['name'] === 'string' ? input['name'] : '';
  }
  if (capabilityId === 'hr.find_employee') {
    return typeof input['name'] === 'string' ? input['name'] : '';
  }
  if (capabilityId === 'projects.assign_employee') {
    const employee = typeof input['employeeName'] === 'string' ? input['employeeName'] : '';
    const project = typeof input['projectName'] === 'string' ? input['projectName'] : '';
    return [employee, project].filter(Boolean).join(' → ');
  }
  if (capabilityId === 'projects.find_project') {
    return typeof input['name'] === 'string' ? input['name'] : '';
  }
  return '';
}

/**
 * The read-only execution timeline of a completed workflow (FRONTEND.md §7
 * workflow execution): one row per step with a status mark, plus the final
 * verification row when the workflow succeeded.
 */
export function WorkflowTimeline({ data }: { data: WorkflowTimelineData }): JSX.Element {
  const succeeded = data.status === 'succeeded';
  return (
    <div
      role="group"
      aria-label="Workflow execution"
      style={{
        alignSelf: 'center',
        width: '100%',
        maxWidth: 360,
        border: '1px solid var(--nexora-border)',
        borderRadius: radius.lg,
        background: 'var(--nexora-surface)',
        padding: spacing[4],
        display: 'flex',
        flexDirection: 'column',
        gap: spacing[2],
      }}
    >
      <div style={CARD_EYEBROW}>Execution</div>
      {data.steps.map((step) => (
        <div key={step.stepId} style={{ display: 'flex', alignItems: 'center', gap: spacing[2.5] }}>
          <StepStatusDot status={step.status} />
          <span style={{ fontSize: typography.sizes.sm }}>{step.name}</span>
        </div>
      ))}
      {succeeded ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: spacing[2.5] }}>
          <StepStatusDot status="succeeded" />
          <span style={{ fontSize: typography.sizes.sm }}>Verify</span>
        </div>
      ) : null}
      <div
        style={{
          marginTop: spacing[1],
          fontSize: typography.sizes.xs,
          color: succeeded ? 'var(--nexora-success)' : 'var(--nexora-danger)',
        }}
      >
        {succeeded ? 'Workflow completed.' : `Workflow ${data.status}.`}
      </div>
    </div>
  );
}

/** The empty conversation state with example prompts. */
function EmptyConversation({
  prompts,
  onPick,
}: {
  prompts: readonly string[];
  onPick: (prompt: string) => void;
}): JSX.Element {
  return (
    <div
      style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: spacing[4],
        textAlign: 'center',
        padding: spacing[4],
      }}
    >
      <span
        aria-hidden
        style={{
          width: 40,
          height: 40,
          borderRadius: radius.lg,
          background: 'var(--nexora-surfaceMuted)',
          border: '1px solid var(--nexora-border)',
          color: 'var(--nexora-textSecondary)',
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <NavIcon name="sparkles" size={18} />
      </span>
      <div>
        <div style={{ fontWeight: typography.weights.semibold, letterSpacing: '-0.01em' }}>
          Ask Nexora anything
        </div>
        <div
          style={{
            fontSize: typography.sizes.sm,
            color: 'var(--nexora-textMuted)',
            marginTop: spacing[1],
            maxWidth: '40ch',
          }}
        >
          The enterprise AI plans, discovers your tools, executes them, and reports the result.
        </div>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: spacing[2], width: '100%' }}>
        {prompts.map((prompt) => (
          <button
            key={prompt}
            type="button"
            onClick={() => onPick(prompt)}
            style={{
              padding: `${spacing[2.5]} ${spacing[3]}`,
              background: 'var(--nexora-surface)',
              border: '1px solid var(--nexora-border)',
              borderRadius: radius.md,
              fontSize: typography.sizes.sm,
              color: 'var(--nexora-textSecondary)',
              textAlign: 'left',
              cursor: 'pointer',
              transition: 'background 140ms ease, border-color 140ms ease, color 140ms ease',
            }}
            onMouseEnter={(event) => {
              event.currentTarget.style.borderColor = 'var(--nexora-borderStrong)';
              event.currentTarget.style.color = 'var(--nexora-text)';
              event.currentTarget.style.background = 'var(--nexora-surfaceMuted)';
            }}
            onMouseLeave={(event) => {
              event.currentTarget.style.borderColor = 'var(--nexora-border)';
              event.currentTarget.style.color = 'var(--nexora-textSecondary)';
              event.currentTarget.style.background = 'var(--nexora-surface)';
            }}
          >
            {prompt}
          </button>
        ))}
      </div>
    </div>
  );
}
