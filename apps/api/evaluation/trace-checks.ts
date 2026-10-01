/**
 * @nexora/app-api — workflow decision-trace assertions for the `audit_trace`
 * check (dataset 1.9.x closure scenarios).
 *
 * Reads what the REAL Audit Center returned over HTTP (the decision trace of an
 * approval or of a workflow step) and verifies the workflow-instance semantics:
 * the instance state, the step / compensation timeline, and — for a composite
 * unit approval — the authorized-versus-executed attribution. Every failure is
 * returned as a short reason; nothing here constructs or fabricates a trace.
 */

import type { StateCheck } from '@nexora/evaluation';
import type { TenantId } from '@nexora/contracts/common';

import type { ScenarioApp } from './harness.js';

type AuditTraceCheck = Extract<StateCheck, { kind: 'audit_trace' }>;

interface TraceStep {
  stepId: string;
  toolId: string;
  purpose: 'step' | 'compensation';
  status: string;
  laterState?: string;
  compensatesStepId?: string;
}

interface TraceBody {
  actors?: {
    requester?: { userId?: string };
    agent?: { agentId?: string };
    approver?: { userId?: string };
    executor?: { kind?: string; userId?: string; agentId?: string };
    executionAuthority?: string;
  };
  executions?: {
    approvalId?: string;
    matchesApprovedInput?: boolean;
    workflow?: { stepId?: string; purpose?: string };
    compositeApproval?: {
      approvalId?: string;
      approvalScope?: string;
      approvedBy?: string;
      role?: string;
    };
  }[];
  workflow?: {
    state?: string;
    rollbackSummary?: string;
    note?: string;
    steps?: TraceStep[];
  };
  attribution?: {
    approvalScope?: string;
    approvalId?: string;
    approvedBy?: string;
    innerExecutionAuthority?: string;
    approverExecutedSteps?: boolean;
    innerExecutionCount?: number;
  };
}

/** The audit event id of the first journaled step of the workflow the approval started. */
export async function firstWorkflowStepEvent(
  harness: ScenarioApp,
  organizationId: string,
  approvalId: string,
): Promise<string | undefined> {
  const instances = await harness.repos.workflowInstances.listByTenant(
    organizationId as TenantId,
    500,
  );
  const instance = instances.find((candidate) => candidate.approvalId === approvalId);
  if (instance === undefined) return undefined;
  const steps = await harness.repos.workflowStepExecutions.listByWorkflow(instance.id);
  const first = steps[0];
  return first === undefined ? undefined : `wfs:${first.id}`;
}

/** The reasons the trace violates the check's workflow / composite expectations. */
export function workflowTraceFailures(
  harness: ScenarioApp,
  check: AuditTraceCheck,
  trace: unknown,
  approvalId: string,
): string[] {
  const failures: string[] = [];
  const body = trace as TraceBody;

  const expected = check.workflow;
  if (expected !== undefined) {
    const workflow = body.workflow;
    if (workflow === undefined) {
      failures.push('workflow section absent');
    } else {
      if (workflow.state !== expected.state)
        failures.push(`workflow.state=${workflow.state ?? 'none'} (expected ${expected.state})`);
      const steps = workflow.steps ?? [];
      for (const want of expected.steps ?? []) {
        const found = steps.find(
          (step) => step.toolId === want.tool && step.purpose === want.purpose,
        );
        if (found === undefined) {
          failures.push(`no ${want.purpose} step ${want.tool}`);
          continue;
        }
        if (found.status !== want.status)
          failures.push(
            `${want.tool} ${want.purpose} status=${found.status} (expected ${want.status})`,
          );
        if (want.laterState !== undefined) {
          const later = found.laterState ?? 'none';
          if (later !== want.laterState)
            failures.push(`${want.tool} laterState=${later} (expected ${want.laterState})`);
        }
      }
      if (expected.failedOnly !== undefined) {
        const failed = steps
          .filter((step) => step.purpose === 'step' && step.status === 'failed')
          .map((step) => step.toolId)
          .sort();
        const allowed = [...expected.failedOnly].sort();
        if (JSON.stringify(failed) !== JSON.stringify(allowed))
          failures.push(`failed steps [${failed.join(', ')}] (expected [${allowed.join(', ')}])`);
      }
      for (const text of expected.noteIncludes ?? []) {
        if (!(workflow.note ?? '').includes(text)) failures.push(`note lacks "${text}"`);
      }
      if (expected.rollbackSummary !== undefined) {
        const has = (workflow.rollbackSummary ?? '') !== '';
        if (has !== expected.rollbackSummary)
          failures.push(`rollbackSummary ${has ? 'present' : 'absent'}`);
      }
    }
  }

  const composite = check.composite;
  if (composite !== undefined) {
    const world = harness.world;
    const requesterId = world.user(composite.requester).id;
    const approverId = world.user(composite.approver).id;
    const agentId = composite.agent === undefined ? undefined : world.entityId(composite.agent);
    const attribution = body.attribution;
    if (attribution === undefined) {
      failures.push('attribution absent');
    } else {
      if (attribution.approvalScope !== 'composite_workflow')
        failures.push(`attribution.approvalScope=${attribution.approvalScope ?? 'none'}`);
      if (attribution.approvalId !== approvalId) failures.push('attribution.approvalId differs');
      if (attribution.approvedBy !== approverId) failures.push('attribution.approvedBy differs');
      if (attribution.innerExecutionAuthority !== 'workflow_instance_under_requester_ceiling')
        failures.push('attribution.innerExecutionAuthority differs');
      if (attribution.approverExecutedSteps !== false)
        failures.push('attribution.approverExecutedSteps is not false');
      if ((attribution.innerExecutionCount ?? 0) < 1)
        failures.push('attribution counts no inner execution');
    }
    const actors = body.actors;
    if (actors?.requester?.userId !== requesterId) failures.push('actors.requester differs');
    if (actors?.approver?.userId !== approverId) failures.push('actors.approver differs');
    if (actors?.executor?.userId !== requesterId)
      failures.push('actors.executor is not the requester');
    if (actors?.executor?.userId === approverId) failures.push('the approver is the executor');
    if ((actors?.executor?.agentId ?? undefined) !== agentId)
      failures.push('actors.executor agent differs');
    if (actors?.executor?.kind !== (agentId === undefined ? 'user' : 'agent'))
      failures.push('actors.executor kind differs');
    if (requesterId === approverId) failures.push('requester equals approver');
    const inner = (body.executions ?? []).filter((execution) => execution.workflow !== undefined);
    if (inner.length === 0) failures.push('no inner workflow execution in the trace');
    for (const execution of inner) {
      const link = execution.compositeApproval;
      if (execution.approvalId !== approvalId)
        failures.push('an inner execution does not reference the unit approval');
      if (
        link?.approvalId !== approvalId ||
        link.approvalScope !== 'composite_workflow' ||
        link.role !== 'authorized_the_composite' ||
        link.approvedBy !== approverId
      )
        failures.push('an inner execution lacks the composite approval link');
      if (execution.matchesApprovedInput === false)
        failures.push('an inner execution is flagged as an input mismatch');
    }
  }
  return failures;
}
