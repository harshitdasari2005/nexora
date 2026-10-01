/**
 * @nexora/app-web — Audit decision-trace client.
 *
 * A typed wrapper over `GET /api/audit/events/:eventId/trace`. The DTO mirrors
 * `apps/api/src/audit/decision-trace.ts`. The trace is a read model of records
 * written at decision time: ids, versions, fingerprints and statuses — never
 * raw documents or model reasoning. The organization + workspace scope travels
 * only in the querystring.
 */

import { api } from './api.js';
import type { GovernanceActors, GovernanceVerificationSource, WorkflowStateKey } from './types.js';

/** The (required) tenant + workspace scope of an audit request. */
export interface AuditScope {
  organizationId: string;
  workspaceId: string;
}

/** One piece of evidence consulted (or derived) for a decision. */
export interface TraceEvidenceDto {
  evidenceId: string;
  sourceType: string;
  sourceId: string;
  title?: string;
  version?: string;
  fingerprint?: string;
  retrievedAt?: string;
  trust?: string;
  retrievalMethod?: string;
  connector?: string;
  /** True for a finding derived from sources — not source evidence itself. */
  derived: boolean;
  invocationId?: string;
}

/** One planned action (a plan is never proof that anything ran). */
export interface TracePlannedDto {
  stepId?: string;
  capabilityId?: string;
  toolId?: string;
  inputFingerprint?: string;
  requiresApproval?: boolean;
  approvalId?: string;
  policyId?: string;
  policyVersion?: string;
}

/** One recorded execution. */
export interface TraceExecutionDto {
  invocationId?: string;
  toolId?: string;
  status?: string;
  origin?: string;
  verified?: boolean;
  inputFingerprint?: string;
  outputFingerprint?: string;
  affectedResource?: { type: string; id: string };
  completedAt?: string;
  approvalId?: string;
  /** False when the executed input differs from the approved input. */
  matchesApprovedInput?: boolean;
  workflow?: { stepId?: string; purpose?: string };
  /** Inner workflow step: the unit approval that authorized the composite. */
  compositeApproval?: TraceCompositeApprovalLinkDto;
  /** An executed forward step later undone (its status stays as executed). */
  laterState?: TraceWorkflowStepDto['laterState'];
  compensatedBy?: string;
  verification?: {
    verified: boolean;
    source: GovernanceVerificationSource;
    limitation?: string;
    checks?: readonly { ruleId: string; passed: boolean }[];
  };
}

/** The unit approval that authorized a composite — never the executor of its steps. */
export interface TraceCompositeApprovalLinkDto {
  approvalId: string;
  approvalScope: 'composite_workflow';
  approvedBy?: string;
  role: 'authorized_the_composite';
}

/** One workflow step or compensation, with its OWN recorded status. */
export interface TraceWorkflowStepDto {
  stepId: string;
  toolId: string;
  name: string;
  purpose: 'step' | 'compensation';
  compensatesStepId?: string;
  status: string;
  executedAt?: string;
  errorCode?: string;
  /** What happened AFTER an executed step ran (its own status is unchanged). */
  laterState?: 'compensated' | 'compensation_failed' | 'not_rolled_back';
  compensatedBy?: string;
}

/** The instance state + step / compensation timeline of a workflow-related event. */
export interface TraceWorkflowDto {
  instanceId: string;
  state: WorkflowStateKey;
  rollbackSummary: string;
  steps: readonly TraceWorkflowStepDto[];
  note: string;
}

/** Who authorized vs. who executed a composite (workflow.*) run. */
export interface TraceCompositeAttributionDto {
  approvalScope: 'composite_workflow';
  approvalId: string;
  approvedBy?: string;
  innerExecutionAuthority: 'workflow_instance_under_requester_ceiling';
  approverExecutedSteps: boolean;
  innerExecutionCount: number;
  statement: string;
}

/** `GET /api/audit/events/:eventId/trace` — the decision trace of one event. */
export interface DecisionTraceDto {
  eventId: string;
  actors?: GovernanceActors;
  request: {
    text?: string;
    actorId?: string;
    organizationId: string;
    workspaceId?: string;
    runId?: string;
  };
  evidence: readonly TraceEvidenceDto[];
  authorization: { agentId?: string; delegationIds: readonly string[]; origin?: string };
  policy?: {
    id: string;
    version: string;
    outcome: string;
    reason?: string;
    rules?: readonly string[];
    contextFingerprint?: string;
  };
  approval?: {
    id: string;
    status: string;
    decidedBy?: string;
    decidedAt?: string;
    inputFingerprint: string;
    requester?: string;
    requiredApproverRoleId?: string;
    separationOfDuties?: boolean;
    expiresAt?: string;
  };
  planned: readonly TracePlannedDto[];
  executions: readonly TraceExecutionDto[];
  workflow?: TraceWorkflowDto;
  attribution?: TraceCompositeAttributionDto;
  lineage: readonly { recordId: string; kind: string; occurredAt: string; subject?: string }[];
}

/** Whether an audit event id belongs to a family that can have a decision trace. */
export function hasDecisionTrace(eventId: string): boolean {
  return /^(apr|agx|wfs):/.test(eventId);
}

/** Fetches the decision trace of one audit event (the id is URL-encoded). */
export async function getDecisionTrace(
  scope: AuditScope,
  eventId: string,
): Promise<DecisionTraceDto> {
  const qs = `organizationId=${encodeURIComponent(scope.organizationId)}&workspaceId=${encodeURIComponent(scope.workspaceId)}`;
  const res = await api<{ trace: DecisionTraceDto }>(
    `/audit/events/${encodeURIComponent(eventId)}/trace?${qs}`,
  );
  return res.trace;
}
