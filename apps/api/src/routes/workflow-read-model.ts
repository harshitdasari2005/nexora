/**
 * @nexora/app-api — the composite-workflow read model.
 *
 * One truthful vocabulary for what a composite workflow (a workflow started
 * through the unit-approved outer tool `workflow.*`, or `POST /api/workflows`)
 * is doing or did. It is DERIVED from records that were written when things
 * happened — the workflow instance + journal, its rollback ledger, the
 * approval row, and the append-only lineage — and stores/decides nothing.
 *
 *   planned              instance exists, has not started executing
 *   waiting_for_approval the unit approval is pending (no instance yet) or the
 *                        instance is paused for one
 *   approved             approved; the instance has not started yet
 *   executing            steps are running
 *   failed               a step failed; nothing state-changing needed undoing
 *   compensated          failed AND every completed step was rolled back
 *   partial              failed and the rollback is INCOMPLETE — something was
 *                        left behind (no safe undo, needs approval, or the undo failed)
 *   verified             succeeded AND every state-changing inner step was
 *                        independently verified (state read-back)
 *   completed_unverified succeeded but not independently verified (the
 *                        limitation is stated)
 *   rejected / expired   the unit approval was refused / lapsed: nothing ran
 *   cancelled            an operator cancelled the instance
 *
 * Never "success": only `verified` and `completed_unverified` describe a
 * succeeded instance; failed / compensated / partial can never be reported as
 * completed. No raw step inputs or outputs are ever exposed — ids, statuses,
 * error codes and verification summaries only. Every lineage read is tenant
 * scoped.
 */

import type { ApprovalRequestRecord } from '@nexora/ai-runtime';
import type { WorkflowExecutionRecord } from '@nexora/contracts/workflow';
import { COMPENSATION_STEP_PREFIX, describeWorkflowRollback } from '@nexora/module-workflow';
import type { LineageRecord, LineageRepository } from '@nexora/module-lineage';
import type { SideEffectClass } from '@nexora/contracts/ai';

/** The composite workflow state vocabulary. */
export type CompositeWorkflowState =
  | 'planned'
  | 'waiting_for_approval'
  | 'approved'
  | 'executing'
  | 'failed'
  | 'compensated'
  | 'partial'
  | 'verified'
  | 'completed_unverified'
  | 'rejected'
  | 'expired'
  | 'cancelled';

/** How one inner step's success was checked. */
export type StepVerificationStatus =
  'verified' | 'self_reported' | 'unverified' | 'missing' | 'not_applicable';

/** Verification of one inner step (from its lineage VERIFICATION record). */
export interface StepVerificationDto {
  status: StepVerificationStatus;
  source?: string;
  limitation?: string;
}

/** The sanitized step: ids, status and verification only — never inputs or outputs. */
export interface WorkflowStepViewDto {
  id: string;
  stepId: string;
  name: string;
  capabilityId: string;
  toolId: string;
  purpose: 'step' | 'compensation';
  /** For a compensation: the forward step it undoes. */
  compensatesStepId?: string;
  status: string;
  attempt: number;
  error?: string;
  errorCode?: string;
  approvalId?: string;
  startedAt: string;
  finishedAt?: string;
  verification: StepVerificationDto;
}

/** Verification summary of an instance. */
export interface WorkflowVerificationSummaryDto {
  /** `verified` only when every counted step was independently verified. */
  status: 'verified' | 'not_independently_verified' | 'not_applicable';
  /** What the checks do not prove (deduplicated). */
  limitations: readonly string[];
  countedSteps: number;
  verifiedSteps: number;
}

/** The sanitized instance. */
export interface WorkflowInstanceViewDto {
  id: string;
  definitionId: string;
  definitionKey: string;
  tenantId: string;
  userId: string;
  workspaceId?: string;
  correlationId: string;
  /** The raw engine status (kept for diagnostics; the UI renders {@link state}). */
  status: string;
  currentStepId?: string;
  error?: string;
  startedAt: string;
  finishedAt?: string;
  origin?: string;
  approvalId?: string;
  initiator: string;
  compensation?: {
    status: string;
    compensatedSteps: readonly string[];
    outstanding: readonly { stepId: string; name: string; reason: string }[];
  };
  /** The truthful composite state. */
  state: CompositeWorkflowState;
  /** One honest sentence for the state (rollback / limitation detail included). */
  stateDetail: string;
  /** Safe rollback statement derived from the ledger ('' when none). */
  rollbackSummary: string;
  /** Error code of the failing step, when known. */
  errorCode?: string;
  verification: WorkflowVerificationSummaryDto;
}

/** A pending / decided unit approval of a composite that has NO instance (yet). */
export interface CompositeApprovalViewDto {
  approvalId: string;
  capabilityId: string;
  definitionKey?: string;
  initiator: string;
  workspaceId?: string;
  state: CompositeWorkflowState;
  stateDetail: string;
  createdAt: string;
  expiresAt: string;
  decidedAt?: string;
  errorCode?: string;
}

/** The detail record. */
export interface WorkflowRecordViewDto {
  instance: WorkflowInstanceViewDto;
  steps: readonly WorkflowStepViewDto[];
  approval?: {
    id: string;
    status: string;
    decidedBy?: string;
    decidedAt?: string;
    expiresAt: string;
  };
}

/** Verification sources that read state back (independent of the handler's own report). */
const INDEPENDENT_SOURCES: ReadonlySet<string> = new Set([
  'state_readback',
  'provider_readback',
  'redetection',
]);

function asString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

/** Strips the compensation prefix. */
function forwardStepId(stepId: string): string {
  return stepId.startsWith(COMPENSATION_STEP_PREFIX)
    ? stepId.slice(COMPENSATION_STEP_PREFIX.length)
    : stepId;
}

interface StepLineage {
  errorCode?: string;
  verification: StepVerificationDto;
}

/** Indexes the run's EXECUTION + VERIFICATION lineage by (purpose, stepId). */
function indexLineage(
  records: readonly LineageRecord[],
  notBefore: string,
): Map<string, StepLineage> {
  const verificationOf = new Map<string, StepVerificationDto>();
  for (const record of records) {
    if (record.kind !== 'VERIFICATION') continue;
    const d = record.data as Record<string, unknown>;
    const of = asString(d['of']) ?? record.invocationId;
    if (of === undefined) continue;
    const source = asString(d['source']) ?? asString(d['method']);
    const limitation = asString(d['limitation']);
    const verified = d['verified'] === true;
    const independent = verified && source !== undefined && INDEPENDENT_SOURCES.has(source);
    verificationOf.set(of, {
      status: independent ? 'verified' : verified ? 'self_reported' : 'unverified',
      ...(source === undefined ? {} : { source }),
      ...(limitation === undefined ? {} : { limitation }),
    });
  }
  const out = new Map<string, StepLineage>();
  for (const record of records) {
    if (record.kind !== 'EXECUTION' || record.occurredAt < notBefore) continue;
    const d = record.data as Record<string, unknown>;
    const wf = d['workflow'] as { stepId?: string; purpose?: string } | undefined;
    if (wf?.stepId === undefined) continue;
    const key = `${wf.purpose === 'compensation' ? 'compensation' : 'step'}:${wf.stepId}`;
    const verification =
      record.invocationId === undefined ? undefined : verificationOf.get(record.invocationId);
    const errorCode = asString(d['errorCode']);
    // Later attempts win (records are ordered by time/seq).
    out.set(key, {
      ...(errorCode === undefined ? {} : { errorCode }),
      verification: verification ?? { status: 'missing' },
    });
  }
  return out;
}

/** Inputs to {@link buildWorkflowRecordView}. */
export interface BuildRecordViewInput {
  record: WorkflowExecutionRecord;
  /** The run's lineage (tenant-scoped read); empty when unavailable. */
  lineage: readonly LineageRecord[];
  /** Whether a tool is read-only (its verification is not counted). */
  sideEffectOf: (toolId: string) => SideEffectClass | undefined;
  approval?: ApprovalRequestRecord;
}

/** Derives the composite state of an instance (pure). */
export function deriveInstanceState(input: {
  status: string;
  compensationStatus?: string;
  verification: WorkflowVerificationSummaryDto;
  hasApproval: boolean;
}): { state: CompositeWorkflowState; detail: string } {
  const { status, compensationStatus } = input;
  switch (status) {
    case 'created':
    case 'planning':
    case 'ready':
      return input.hasApproval
        ? { state: 'approved', detail: 'Approved — execution has not started yet.' }
        : { state: 'planned', detail: 'Planned — execution has not started.' };
    case 'awaiting_approval':
      return {
        state: 'waiting_for_approval',
        detail: 'Paused — waiting for an approval decision.',
      };
    case 'running':
      return { state: 'executing', detail: 'Executing — steps are running.' };
    case 'cancelled':
      return { state: 'cancelled', detail: 'Cancelled by an operator before it finished.' };
    case 'compensated':
      return {
        state: 'compensated',
        detail: 'Failed and rolled back — every completed step was undone.',
      };
    case 'succeeded':
      if (input.verification.status === 'verified') {
        return {
          state: 'verified',
          detail: 'Completed and every state-changing step was independently verified.',
        };
      }
      return {
        state: 'completed_unverified',
        detail:
          'Completed — not independently verified.' +
          (input.verification.limitations.length > 0
            ? ` Limitation: ${input.verification.limitations.join('; ')}.`
            : ''),
      };
    case 'failed':
    default:
      if (compensationStatus === 'compensated') {
        return {
          state: 'compensated',
          detail: 'Failed and rolled back — every completed step was undone.',
        };
      }
      if (compensationStatus === 'partial') {
        return {
          state: 'partial',
          detail:
            'Failed and only partially completed — the rollback is incomplete; manual recovery is required.',
        };
      }
      if (compensationStatus === 'failed') {
        return {
          state: 'partial',
          detail:
            'Failed and only partially completed — the rollback itself failed and can be retried.',
        };
      }
      return { state: 'failed', detail: 'Failed — no state-changing step had completed.' };
  }
}

/** Builds the sanitized record view (pure over its inputs). */
export function buildWorkflowRecordView(input: BuildRecordViewInput): WorkflowRecordViewDto {
  const { record, approval } = input;
  const { instance } = record;
  const byStep = indexLineage(input.lineage, instance.startedAt);

  const steps: WorkflowStepViewDto[] = record.steps.map((step) => {
    const isCompensation = step.stepId.startsWith(COMPENSATION_STEP_PREFIX);
    const base = forwardStepId(step.stepId);
    const lineage = byStep.get(`${isCompensation ? 'compensation' : 'step'}:${base}`);
    const readOnly = input.sideEffectOf(step.toolId) === 'read_only';
    const verification: StepVerificationDto =
      step.status !== 'succeeded' || isCompensation || readOnly
        ? { status: 'not_applicable' }
        : (lineage?.verification ?? { status: 'missing' });
    return {
      id: step.id,
      stepId: step.stepId,
      name: step.name,
      capabilityId: step.capabilityId,
      toolId: step.toolId,
      purpose: isCompensation ? 'compensation' : 'step',
      ...(isCompensation ? { compensatesStepId: base } : {}),
      status: step.status,
      attempt: step.attempt,
      ...(step.error === undefined ? {} : { error: step.error }),
      ...(lineage?.errorCode === undefined ? {} : { errorCode: lineage.errorCode }),
      ...(step.approvalId === undefined ? {} : { approvalId: step.approvalId }),
      startedAt: step.startedAt,
      ...(step.finishedAt === undefined ? {} : { finishedAt: step.finishedAt }),
      verification,
    };
  });

  const counted = steps.filter(
    (step) =>
      step.purpose === 'step' &&
      step.status === 'succeeded' &&
      step.verification.status !== 'not_applicable',
  );
  const verifiedCount = counted.filter((step) => step.verification.status === 'verified').length;
  const limitations = [
    ...new Set(
      counted
        .filter((step) => step.verification.status !== 'verified')
        .map(
          (step) =>
            step.verification.limitation ??
            (step.verification.status === 'missing'
              ? 'no verification record was found for this step'
              : step.verification.status === 'unverified'
                ? 'the step reported success but its verification did not pass'
                : 'no independent state read-back'),
        ),
    ),
  ];
  const rawVerification: WorkflowVerificationSummaryDto =
    counted.length === 0
      ? { status: 'not_applicable', limitations: [], countedSteps: 0, verifiedSteps: 0 }
      : {
          status: verifiedCount === counted.length ? 'verified' : 'not_independently_verified',
          limitations,
          countedSteps: counted.length,
          verifiedSteps: verifiedCount,
        };
  // Verification only characterizes a SUCCEEDED instance: a failed / compensated
  // / partial run is never described as verified.
  const verification: WorkflowVerificationSummaryDto =
    instance.status === 'succeeded'
      ? rawVerification
      : { ...rawVerification, status: 'not_applicable', limitations: [] };

  const { state, detail } = deriveInstanceState({
    status: instance.status,
    ...(instance.compensation === undefined
      ? {}
      : { compensationStatus: instance.compensation.status }),
    verification,
    hasApproval: instance.approvalId !== undefined,
  });
  const rollbackSummary = describeWorkflowRollback(record);
  const failingStep = steps.find((step) => step.purpose === 'step' && step.status === 'failed');

  const instanceView: WorkflowInstanceViewDto = {
    id: instance.id,
    definitionId: instance.definitionId,
    definitionKey: instance.definitionKey,
    tenantId: instance.tenantId,
    userId: instance.userId,
    ...(instance.workspaceId === undefined ? {} : { workspaceId: instance.workspaceId }),
    correlationId: instance.correlationId,
    status: instance.status,
    ...(instance.currentStepId === undefined ? {} : { currentStepId: instance.currentStepId }),
    ...(instance.error === undefined ? {} : { error: instance.error }),
    startedAt: instance.startedAt,
    ...(instance.finishedAt === undefined ? {} : { finishedAt: instance.finishedAt }),
    ...(instance.origin === undefined ? {} : { origin: instance.origin }),
    ...(instance.approvalId === undefined ? {} : { approvalId: instance.approvalId }),
    initiator: instance.userId,
    ...(instance.compensation === undefined
      ? {}
      : {
          compensation: {
            status: instance.compensation.status,
            compensatedSteps: instance.compensation.compensatedSteps,
            outstanding: instance.compensation.outstanding.map((o) => ({
              stepId: o.stepId,
              name: o.name,
              reason: o.reason,
            })),
          },
        }),
    state,
    stateDetail: rollbackSummary === '' ? detail : `${detail} ${rollbackSummary}`,
    rollbackSummary,
    ...(failingStep?.errorCode === undefined ? {} : { errorCode: failingStep.errorCode }),
    verification,
  };

  return {
    instance: instanceView,
    steps,
    ...(approval === undefined
      ? {}
      : {
          approval: {
            id: approval.id,
            status: approval.status,
            ...(approval.decidedBy === undefined ? {} : { decidedBy: approval.decidedBy }),
            ...(approval.decidedAt === undefined ? {} : { decidedAt: approval.decidedAt }),
            expiresAt: approval.expiresAt,
          },
        }),
  };
}

/** Whether an approval gates a composite workflow (its outer capability is `workflow.*`). */
export function isWorkflowApproval(approval: Pick<ApprovalRequestRecord, 'capabilityId'>): boolean {
  return approval.capabilityId.startsWith('workflow.');
}

/**
 * The state of a composite's UNIT approval when NO instance exists for it.
 * (An approved approval with an instance is described by the instance.)
 */
export function approvalOnlyView(approval: ApprovalRequestRecord): CompositeApprovalViewDto {
  const base = {
    approvalId: approval.id,
    capabilityId: approval.capabilityId,
    initiator: approval.userId,
    ...(approval.workspaceId === undefined ? {} : { workspaceId: approval.workspaceId }),
    createdAt: approval.createdAt,
    expiresAt: approval.expiresAt,
    ...(approval.decidedAt === undefined ? {} : { decidedAt: approval.decidedAt }),
  };
  switch (approval.status) {
    case 'proposed':
      return { ...base, state: 'planned', stateDetail: 'Planned — nothing has run.' };
    case 'awaiting_approval':
      return {
        ...base,
        state: 'waiting_for_approval',
        stateDetail: 'Waiting for approval — nothing has run and no workflow instance exists yet.',
      };
    case 'approved':
      return {
        ...base,
        state: 'approved',
        stateDetail: 'Approved — the workflow has not started executing yet.',
      };
    case 'executing':
      return {
        ...base,
        state: 'executing',
        stateDetail: 'Approved and executing — the workflow instance is starting.',
      };
    case 'rejected':
      return {
        ...base,
        state: 'rejected',
        stateDetail: 'Approval rejected — the workflow never ran; nothing was changed.',
      };
    case 'expired':
      return {
        ...base,
        state: 'expired',
        stateDetail: 'Approval expired — the workflow never ran; nothing was changed.',
      };
    case 'completed':
      return {
        ...base,
        state: 'approved',
        stateDetail: 'Approved and executed — no workflow instance record was found for it.',
      };
    case 'failed':
    default:
      // An approved unit that ended without an instance was refused before any
      // step ran (inner policy / approval-coverage preflight, capability denial).
      return {
        ...base,
        state: 'failed',
        stateDetail:
          'Failed before any step ran — the workflow was refused at preflight; nothing was changed.',
      };
  }
}

/** Reads the run's lineage, tenant-scoped; never throws into the route. */
export async function readRunLineage(
  repository: LineageRepository | undefined,
  tenantId: string,
  runId: string,
): Promise<readonly LineageRecord[]> {
  if (repository === undefined) return [];
  try {
    return await repository.list(tenantId, { runId });
  } catch {
    return [];
  }
}
