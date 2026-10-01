/**
 * @nexora/app-web — decision trace for one Audit Center event.
 *
 * Answers "why did this happen, on what information, and what actually ran?"
 * from the backend read model. Every value is shown as recorded — nothing is
 * inferred, and there is no model reasoning. Sections are collapsed by default
 * behind a one-line summary. Evidence informs decisions; it never grants
 * authority.
 */

import { useEffect, useState } from 'react';
import { Badge, Skeleton, Stack, typography } from '@nexora/design-system';

import { ApiError } from '../lib/api.js';
import {
  getDecisionTrace,
  hasDecisionTrace,
  type AuditScope,
  type DecisionTraceDto,
  type TraceWorkflowDto,
} from '../lib/audit.js';
import { executionAuthorityLabel, verificationLabel } from '../lib/governance.js';
import { stateStyle } from '../lib/workflowState.js';

/** The load state of a trace. */
export type DecisionTraceState =
  | { kind: 'loading' }
  | { kind: 'none' }
  | { kind: 'forbidden' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; trace: DecisionTraceDto };

const MUTED = { fontSize: typography.sizes.xs, color: 'var(--nexora-textMuted)' } as const;
const MONO = { fontFamily: typography.fontMono } as const;

function when(iso: string | undefined): string {
  if (iso === undefined) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleString('en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
      });
}

/** A short fingerprint prefix with the full value on hover. */
function Fingerprint({ value }: { value: string | undefined }): JSX.Element {
  if (value === undefined) return <span>—</span>;
  return (
    <span title={value} style={MONO}>
      {value.length > 12 ? `${value.slice(0, 12)}…` : value}
    </span>
  );
}

function Section({
  title,
  question,
  summary,
  open,
  children,
}: {
  title: string;
  question?: string;
  summary: string;
  open?: boolean;
  children: React.ReactNode;
}): JSX.Element {
  return (
    <details className="nexora-trace-section" open={open}>
      <summary style={{ cursor: 'pointer', fontSize: typography.sizes.sm }}>
        <strong>{title}</strong>
        {question !== undefined ? <span style={MUTED}> — {question}</span> : null}
        <span style={MUTED}> · {summary}</span>
      </summary>
      <div style={{ padding: '8px 0 4px 12px' }}>{children}</div>
    </details>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }): JSX.Element {
  return (
    <div style={{ display: 'flex', gap: 8, fontSize: typography.sizes.xs, padding: '2px 0' }}>
      <span style={{ color: 'var(--nexora-textMuted)', minWidth: 96 }}>{label}</span>
      <span style={{ overflowWrap: 'anywhere' }}>{children}</span>
    </div>
  );
}

/** What became of an executed forward step AFTER it ran (its own status is unchanged). */
const LATER_STATE_LABEL = {
  compensated: 'Later compensated — undone by the rollback',
  compensation_failed: 'Rollback of this step failed',
  not_rolled_back: 'Left behind — not rolled back',
} as const;

/** A step's own recorded status in plain words (never "success"). */
function stepStatusWord(status: string): string {
  return status === 'succeeded' ? 'Executed' : status === 'failed' ? 'Failed' : status;
}

/** The step / compensation timeline and the final instance state of a workflow event. */
function WorkflowTimeline({ workflow }: { workflow: TraceWorkflowDto }): JSX.Element {
  const style = stateStyle(workflow.state);
  return (
    <div data-testid="trace-workflow">
      <Row label="Final state">
        <Badge tone={style.tone}>{style.label}</Badge>
      </Row>
      <p style={{ ...MUTED, margin: '4px 0' }} data-testid="trace-workflow-note">
        {workflow.note}
      </p>
      {workflow.rollbackSummary !== '' ? (
        <p style={{ ...MUTED, margin: '4px 0' }}>{workflow.rollbackSummary}</p>
      ) : null}
      <ol style={{ margin: '4px 0', paddingLeft: 16, fontSize: typography.sizes.xs }}>
        {workflow.steps.map((step) => (
          <li key={step.stepId} data-testid="trace-workflow-step" style={{ marginBottom: 4 }}>
            {step.purpose === 'compensation' ? (
              <>
                <Badge tone="warning">Compensation</Badge> {step.name} —{' '}
                {stepStatusWord(step.status)}
                {step.compensatesStepId !== undefined ? ` (undoes ${step.compensatesStepId})` : ''}
              </>
            ) : (
              <>
                {step.name} — {stepStatusWord(step.status)}
              </>
            )}
            {step.errorCode !== undefined ? ` · ${step.errorCode}` : ''}
            {step.executedAt !== undefined ? ` · ${when(step.executedAt)}` : ''}
            {step.laterState !== undefined ? (
              <>
                {' '}
                <Badge tone={step.laterState === 'compensated' ? 'warning' : 'danger'}>
                  {LATER_STATE_LABEL[step.laterState]}
                </Badge>
              </>
            ) : null}
          </li>
        ))}
      </ol>
    </div>
  );
}

/** The pure trace content (exported for tests). */
export function DecisionTraceView({ trace }: { trace: DecisionTraceDto }): JSX.Element {
  const sources = trace.evidence.filter((e) => !e.derived).length;
  const derived = trace.evidence.length - sources;
  const mismatches = trace.executions.filter((e) => e.matchesApprovedInput === false).length;
  return (
    <Stack gap={2} data-testid="decision-trace">
      <p style={{ ...MUTED, margin: 0 }}>
        {trace.evidence.length} evidence · {trace.planned.length} planned ·{' '}
        {trace.executions.length} executed · {trace.lineage.length} lineage records
        {mismatches > 0 ? ` · ${mismatches} input mismatch` : ''}
      </p>
      <p style={{ ...MUTED, margin: 0 }}>Evidence informs decisions; it never grants authority.</p>

      {trace.actors !== undefined ? (
        <Section
          title="Actors"
          question="Who requested, approved and executed?"
          summary={`requester ${trace.actors.requester.name ?? trace.actors.requester.userId}`}
        >
          <div data-testid="trace-actors">
            <Row label="Requested by">
              {trace.actors.requester.name ?? trace.actors.requester.userId}
              {trace.actors.requester.name !== undefined ? (
                <span style={MONO}> ({trace.actors.requester.userId})</span>
              ) : null}
            </Row>
            <Row label="Acted by (agent)">
              {trace.actors.agent !== undefined
                ? `${trace.actors.agent.agentId}${
                    trace.actors.agent.delegationId !== undefined
                      ? ` · delegation ${trace.actors.agent.delegationId}`
                      : ''
                  }`
                : 'no agent involved'}
            </Row>
            <Row label="Approved by">
              {trace.actors.approver !== undefined
                ? `${trace.actors.approver.name ?? trace.actors.approver.userId} · ${when(trace.actors.approver.decidedAt)}`
                : 'no approval recorded'}
            </Row>
            <Row label="Executed as">
              {trace.actors.executor.kind === 'agent'
                ? `agent ${trace.actors.executor.agentId ?? ''}`.trim()
                : 'user'}{' '}
              ({trace.actors.executor.userId}) —{' '}
              {executionAuthorityLabel(trace.actors.executionAuthority)}
            </Row>
          </div>
        </Section>
      ) : null}

      {trace.workflow !== undefined ? (
        <Section
          title="Workflow"
          question="What state did the workflow end in?"
          summary={stateStyle(trace.workflow.state).label}
          open
        >
          <WorkflowTimeline workflow={trace.workflow} />
        </Section>
      ) : null}

      {trace.attribution !== undefined ? (
        <Section
          title="Composite authority"
          question="Who authorized it, and who executed it?"
          summary={
            trace.attribution.approverExecutedSteps
              ? 'approver appears as an executor'
              : 'approval authorized the composite; the approver executed nothing'
          }
          open
        >
          <div data-testid="trace-attribution">
            <p style={{ ...MUTED, margin: '0 0 4px 0' }}>{trace.attribution.statement}</p>
            <Row label="Approval scope">Composite workflow — approved as one unit</Row>
            <Row label="Approved by">
              {trace.attribution.approvedBy ?? 'not approved'}
              {trace.actors?.approver?.name !== undefined ? ` (${trace.actors.approver.name})` : ''}
            </Row>
            <Row label="Inner steps ran under">
              The workflow instance, within the requester&apos;s capability ceiling (
              {trace.attribution.innerExecutionCount} recorded)
            </Row>
            <Row label="Approver executed">
              {trace.attribution.approverExecutedSteps ? (
                <Badge tone="danger">Yes — investigate</Badge>
              ) : (
                'No — the approver did not execute any step'
              )}
            </Row>
          </div>
        </Section>
      ) : null}

      <Section
        title="Request"
        question="What was requested?"
        summary={trace.request.text ?? 'no request text recorded'}
      >
        {trace.request.text !== undefined ? <Row label="Request">{trace.request.text}</Row> : null}
        {trace.request.actorId !== undefined ? (
          <Row label="Actor">{trace.request.actorId}</Row>
        ) : null}
        <Row label="Organization">{trace.request.organizationId}</Row>
        {trace.request.workspaceId !== undefined ? (
          <Row label="Workspace">{trace.request.workspaceId}</Row>
        ) : null}
        {trace.request.runId !== undefined ? <Row label="Run">{trace.request.runId}</Row> : null}
      </Section>

      <Section
        title="Evidence"
        question="What information was used?"
        summary={`${sources} source${sources === 1 ? '' : 's'}, ${derived} derived`}
      >
        {trace.evidence.length === 0 ? (
          <span style={MUTED}>No evidence recorded.</span>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table
              style={{ width: '100%', fontSize: typography.sizes.xs, borderCollapse: 'collapse' }}
            >
              <thead>
                <tr style={{ textAlign: 'left', color: 'var(--nexora-textMuted)' }}>
                  <th>Source</th>
                  <th>Source id</th>
                  <th>Version</th>
                  <th>Retrieved</th>
                  <th>Trust</th>
                  <th>Fingerprint</th>
                </tr>
              </thead>
              <tbody>
                {trace.evidence.map((e) => (
                  <tr key={e.evidenceId} style={{ verticalAlign: 'top' }}>
                    <td>
                      {e.sourceType}
                      {e.title !== undefined ? ` · ${e.title}` : ''}
                      {e.derived ? (
                        <div>
                          <Badge tone="warning">Derived finding — not source evidence</Badge>
                        </div>
                      ) : null}
                    </td>
                    <td style={MONO}>{e.sourceId}</td>
                    <td>{e.version ?? '—'}</td>
                    <td>{when(e.retrievedAt)}</td>
                    <td>{e.trust ?? '—'}</td>
                    <td>
                      <Fingerprint value={e.fingerprint} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      <Section
        title="Authorization"
        summary={trace.authorization.agentId ?? trace.authorization.origin ?? 'no agent recorded'}
      >
        {trace.authorization.agentId !== undefined ? (
          <Row label="Agent">{trace.authorization.agentId}</Row>
        ) : null}
        <Row label="Delegations">
          {trace.authorization.delegationIds.length > 0
            ? trace.authorization.delegationIds.join(', ')
            : '—'}
        </Row>
        <Row label="Origin">{trace.authorization.origin ?? '—'}</Row>
      </Section>

      <Section
        title="Policy"
        summary={
          trace.policy !== undefined
            ? `${trace.policy.id} → ${trace.policy.outcome}`
            : 'none recorded'
        }
      >
        {trace.policy === undefined ? (
          <span style={MUTED}>No policy decision recorded.</span>
        ) : (
          <>
            <Row label="Policy">{trace.policy.id}</Row>
            <Row label="Version">{trace.policy.version}</Row>
            <Row label="Outcome">{trace.policy.outcome}</Row>
            {trace.policy.reason !== undefined ? (
              <Row label="Reason">{trace.policy.reason}</Row>
            ) : null}
            {trace.policy.rules !== undefined && trace.policy.rules.length > 0 ? (
              <Row label="Rules">{trace.policy.rules.join(', ')}</Row>
            ) : null}
          </>
        )}
      </Section>

      <Section
        title="Approval"
        summary={trace.approval !== undefined ? trace.approval.status : 'none recorded'}
      >
        {trace.approval === undefined ? (
          <span style={MUTED}>No approval recorded.</span>
        ) : (
          <>
            <Row label="Status">{trace.approval.status}</Row>
            {trace.approval.requester !== undefined ? (
              <Row label="Requested by">{trace.approval.requester}</Row>
            ) : null}
            <Row label="Decided by">{trace.approval.decidedBy ?? '—'}</Row>
            <Row label="Decided at">{when(trace.approval.decidedAt)}</Row>
            {trace.approval.requiredApproverRoleId !== undefined ? (
              <Row label="Approver role">{trace.approval.requiredApproverRoleId}</Row>
            ) : null}
            {trace.approval.separationOfDuties !== undefined ? (
              <Row label="Separation">
                <Badge tone={trace.approval.separationOfDuties ? 'success' : 'neutral'}>
                  {trace.approval.separationOfDuties
                    ? 'Separation of duties enforced'
                    : 'Separation of duties not required'}
                </Badge>
              </Row>
            ) : null}
            {trace.approval.expiresAt !== undefined ? (
              <Row label="Expires">{when(trace.approval.expiresAt)}</Row>
            ) : null}
            <Row label="Input">
              <Fingerprint value={trace.approval.inputFingerprint} />
            </Row>
          </>
        )}
      </Section>

      <Section
        title="Planned vs executed"
        summary={`${trace.planned.length} planned, ${trace.executions.length} executed`}
      >
        <div data-testid="trace-planned">
          <div style={{ fontWeight: typography.weights.medium, fontSize: typography.sizes.xs }}>
            Planned (not proof of execution)
          </div>
          {trace.planned.length === 0 ? (
            <span style={MUTED}>Nothing planned.</span>
          ) : (
            <ul style={{ margin: '4px 0', paddingLeft: 16, fontSize: typography.sizes.xs }}>
              {trace.planned.map((p, i) => (
                <li key={p.stepId ?? `${p.toolId ?? p.capabilityId ?? 'plan'}-${i}`}>
                  {p.toolId ?? p.capabilityId ?? p.stepId ?? 'step'}
                  {p.requiresApproval === true ? ' · requires approval' : ''}
                  {p.policyId !== undefined ? ` · ${p.policyId}@${p.policyVersion ?? '?'}` : ''}
                </li>
              ))}
            </ul>
          )}
        </div>
        <div
          data-testid="trace-executed"
          style={{ marginTop: 8, paddingTop: 8, borderTop: '1px solid var(--nexora-border)' }}
        >
          <div style={{ fontWeight: typography.weights.medium, fontSize: typography.sizes.xs }}>
            Executed
          </div>
          {trace.executions.length === 0 ? (
            <span style={MUTED}>Nothing recorded as executed.</span>
          ) : (
            <ul style={{ margin: '4px 0', paddingLeft: 16, fontSize: typography.sizes.xs }}>
              {trace.executions.map((x, i) => (
                <li key={x.invocationId ?? `exec-${i}`} style={{ marginBottom: 6 }}>
                  <div>
                    {x.toolId ?? 'tool'} · {x.status ?? 'status unknown'} · verified{' '}
                    {x.verified === true ? 'yes' : 'no'}
                    {x.workflow?.purpose === 'compensation' ? (
                      <>
                        {' '}
                        <Badge tone="danger">Compensation step</Badge>
                      </>
                    ) : x.workflow?.purpose !== undefined ? (
                      ` · ${x.workflow.purpose}`
                    ) : null}
                  </div>
                  {x.verification !== undefined ? (
                    <div style={MUTED} data-testid="trace-verification">
                      {verificationLabel(x.verification)} ({x.verification.source})
                      {x.verification.limitation !== undefined
                        ? ` · Limitation: ${x.verification.limitation}`
                        : ''}
                      {x.verification.checks?.filter((c) => !c.passed).length ? (
                        <span style={{ color: 'var(--nexora-danger)' }}>
                          {' '}
                          · Failed checks:{' '}
                          {x.verification.checks
                            .filter((c) => !c.passed)
                            .map((c) => c.ruleId)
                            .join(', ')}
                        </span>
                      ) : null}
                    </div>
                  ) : null}
                  {x.compositeApproval !== undefined ? (
                    <div style={MUTED} data-testid="trace-composite-link">
                      Authorized as part of the composite by approval{' '}
                      {x.compositeApproval.approvalId}
                      {x.compositeApproval.approvedBy !== undefined
                        ? ` (approved by ${x.compositeApproval.approvedBy})`
                        : ''}{' '}
                      — the approver did not execute this step.
                    </div>
                  ) : null}
                  {x.laterState !== undefined ? (
                    <div style={MUTED} data-testid="trace-later-state">
                      Executed as recorded · {LATER_STATE_LABEL[x.laterState]}
                      {x.compensatedBy !== undefined ? ` (by ${x.compensatedBy})` : ''}
                    </div>
                  ) : null}
                  {x.affectedResource !== undefined ? (
                    <div style={MUTED}>
                      Affected: {x.affectedResource.type} {x.affectedResource.id}
                    </div>
                  ) : null}
                  {x.matchesApprovedInput === false ? (
                    <div role="alert" style={{ color: 'var(--nexora-danger)', fontWeight: 600 }}>
                      Warning: executed input does not match the approved input.
                    </div>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </div>
      </Section>

      <Section title="Lineage" summary={`${trace.lineage.length} records`}>
        {trace.lineage.length === 0 ? (
          <span style={MUTED}>No lineage records.</span>
        ) : (
          <ol style={{ margin: 0, paddingLeft: 16, fontSize: typography.sizes.xs }}>
            {trace.lineage.map((l) => (
              <li key={l.recordId}>
                {l.kind} · {when(l.occurredAt)}
                {l.subject !== undefined ? ` · ${l.subject}` : ''}
              </li>
            ))}
          </ol>
        )}
      </Section>
    </Stack>
  );
}

/** Renders one load state (exported for tests). */
export function DecisionTraceBody({ state }: { state: DecisionTraceState }): JSX.Element {
  switch (state.kind) {
    case 'loading':
      return (
        <Stack gap={2}>
          <Skeleton height={14} />
          <Skeleton height={14} />
        </Stack>
      );
    case 'none':
      return <p style={MUTED}>No decision trace is recorded for this event.</p>;
    case 'forbidden':
      return <p style={MUTED}>You do not have permission to view decision traces.</p>;
    case 'error':
      return (
        <p role="alert" style={{ ...MUTED, color: 'var(--nexora-danger)' }}>
          Could not load the decision trace: {state.message}
        </p>
      );
    case 'ready':
      return <DecisionTraceView trace={state.trace} />;
  }
}

/** Fetches (only for apr:/agx:/wfs: events) and renders the decision trace. */
export function DecisionTracePanel({
  eventId,
  scope,
}: {
  eventId: string;
  scope: AuditScope;
}): JSX.Element | null {
  const eligible = hasDecisionTrace(eventId);
  const [state, setState] = useState<DecisionTraceState>({ kind: 'loading' });
  const { organizationId, workspaceId } = scope;

  useEffect(() => {
    if (!eligible) return;
    let cancelled = false;
    setState({ kind: 'loading' });
    getDecisionTrace({ organizationId, workspaceId }, eventId)
      .then((trace) => {
        if (!cancelled) setState({ kind: 'ready', trace });
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        if (error instanceof ApiError && error.status === 404) setState({ kind: 'none' });
        else if (error instanceof ApiError && error.status === 403) setState({ kind: 'forbidden' });
        else
          setState({
            kind: 'error',
            message: error instanceof ApiError ? error.message : 'Request failed',
          });
      });
    return () => {
      cancelled = true;
    };
  }, [eligible, eventId, organizationId, workspaceId]);

  if (!eligible) return null;
  return (
    <Stack gap={1.5}>
      <div style={{ ...MUTED, fontWeight: typography.weights.medium }}>Decision trace</div>
      <DecisionTraceBody state={state} />
    </Stack>
  );
}
