/**
 * @nexora/app-api — the decision trace (Prompt 6).
 *
 * For one Audit Center event (an approval, an agent execution, a workflow
 * step) this assembles the structured answer to "why did this happen, on what
 * information, and what actually ran?":
 *
 *   REQUEST → EVIDENCE → AUTHORIZATION → POLICY → APPROVAL
 *           → PLANNED vs EXECUTED → VERIFICATION → LINEAGE
 *
 * It is a READ MODEL over records that were written when things happened
 * (approval rows, the append-only lineage, the workflow journal). It stores
 * nothing, decides nothing, and is never consulted by any authorization path.
 * It carries ids, versions, fingerprints and statuses — never raw documents,
 * tool outputs, secrets, or model reasoning. Every read is tenant-scoped.
 *
 * Plan vs execution stay separate: PLANNED actions come from PLANNED_ACTION
 * records, EXECUTIONS from EXECUTION records, VERIFICATION from its own
 * records — a plan is never evidence that anything ran.
 */

import type { TenantId } from '@nexora/contracts/common';
import type { SideEffectClass } from '@nexora/contracts/ai';
import type { ApprovalEngine, ApprovalRequestRecord } from '@nexora/ai-runtime';
import type {
  WorkflowInstance,
  WorkflowInstanceRepository,
  WorkflowStepExecutionRepository,
} from '@nexora/module-workflow';
import type { AgentExecutionRecorder } from '@nexora/module-agents';
import { fingerprintOf, type LineageRecord, type LineageRepository } from '@nexora/module-lineage';

import {
  buildWorkflowRecordView,
  isWorkflowApproval,
  type CompositeWorkflowState,
} from '../routes/workflow-read-model.js';
import {
  buildActors,
  verificationByInvocation,
  withActorNames,
  type ExecutionVerificationDto,
  type GovernanceActors,
} from './governance-actors.js';

export type { ExecutionVerificationDto, GovernanceActors } from './governance-actors.js';

/** One piece of evidence the run retrieved. */
export interface TraceEvidence {
  evidenceId: string;
  sourceType: string;
  sourceId: string;
  title?: string;
  version?: number | string;
  fingerprint?: string;
  retrievedAt?: string;
  trust?: string;
  retrievalMethod?: string;
  connector?: string;
  /** True for a DERIVED finding (never primary source evidence). */
  derived: boolean;
  invocationId?: string;
}

/**
 * The authority link of an inner workflow execution to the UNIT approval that
 * authorized the composite. Descriptive only: the approval authorized the
 * composite as a whole — it never makes the approver an executor.
 */
export interface TraceCompositeApprovalLink {
  approvalId: string;
  approvalScope: 'composite_workflow';
  /** The user who decided the unit approval (never the executor). */
  approvedBy?: string;
  /** How to read this link. */
  role: 'authorized_the_composite';
}

/** One step of the workflow section (ids, statuses, codes — never inputs or outputs). */
export interface TraceWorkflowStep {
  stepId: string;
  toolId: string;
  name: string;
  purpose: 'step' | 'compensation';
  /** For a compensation: the forward step it undid (or tried to undo). */
  compensatesStepId?: string;
  /** The step's OWN recorded status — never rewritten by a later rollback. */
  status: string;
  executedAt?: string;
  errorCode?: string;
  /**
   * For a forward step that executed: what happened to it AFTER it ran. The
   * step stays `succeeded`; this only records that it was later undone (or
   * that the undo failed / never happened).
   */
  laterState?: 'compensated' | 'compensation_failed' | 'not_rolled_back';
  /** The compensation step that undid it. */
  compensatedBy?: string;
}

/** The instance-state section of a workflow-related trace. */
export interface TraceWorkflowSection {
  instanceId: string;
  /** The SAME derivation as the workflow read model (never "success" for failed / compensated / partial). */
  state: CompositeWorkflowState;
  /** Safe rollback statement from the journaled ledger ('' when none was needed). */
  rollbackSummary: string;
  steps: readonly TraceWorkflowStep[];
  /** A deterministic, plain-language reading of the timeline. */
  note: string;
}

/** Who authorized vs. who executed a composite (workflow.*) run. */
export interface TraceCompositeAttribution {
  approvalScope: 'composite_workflow';
  approvalId: string;
  approvedBy?: string;
  /** Inner steps run under the workflow instance, bounded by the requester's capability ceiling. */
  innerExecutionAuthority: 'workflow_instance_under_requester_ceiling';
  /** Computed from lineage: true only if a record shows the (distinct) approver as an executing actor. */
  approverExecutedSteps: boolean;
  /** Inner executions recorded under the unit approval. */
  innerExecutionCount: number;
  statement: string;
}

/** The structured decision trace of one audit event. */
export interface DecisionTraceDto {
  eventId: string;
  request: {
    text?: string;
    actorId?: string;
    organizationId: string;
    workspaceId?: string;
    runId?: string;
  };
  evidence: readonly TraceEvidence[];
  /**
   * Who was involved: the requester (the actor of record), the agent acting for
   * them, the approver (descriptive — never the actor/executor), the executor
   * and which authority bounded execution.
   */
  actors: GovernanceActors;
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
    /** The user whose request opened the approval. */
    requester: string;
    /** When set, only an approver holding this role could decide. */
    requiredApproverRoleId?: string;
    /** The decider had to differ from the requester. */
    separationOfDuties: boolean;
    /** After this instant the approval could no longer be decided or executed. */
    expiresAt: string;
    /** sha256 of the exact arguments that were approved (the STORED approval input). */
    inputFingerprint: string;
  };
  planned: readonly {
    stepId?: string;
    capabilityId?: string;
    toolId?: string;
    inputFingerprint?: string;
    requiresApproval?: boolean;
    approvalId?: string;
    policyId?: string;
    policyVersion?: string;
  }[];
  executions: readonly {
    invocationId?: string;
    toolId?: string;
    status?: string;
    origin?: string;
    verified?: boolean;
    /** How it was verified: the tool's DECLARED source + what that does not prove. */
    verification?: ExecutionVerificationDto;
    inputFingerprint?: string;
    outputFingerprint?: string;
    affectedResource?: { type: string; id: string };
    completedAt?: string;
    approvalId?: string;
    /** For approved actions: did what ran use exactly the approved arguments? */
    matchesApprovedInput?: boolean;
    workflow?: { stepId?: string; purpose?: string };
    /** Inner workflow execution: the unit approval that authorized the composite (not the executor). */
    compositeApproval?: TraceCompositeApprovalLink;
    /** Forward step later undone by the workflow's compensation (its own status stays as executed). */
    laterState?: TraceWorkflowStep['laterState'];
    compensatedBy?: string;
  }[];
  /** Instance state + step / compensation timeline of a workflow-related event. */
  workflow?: TraceWorkflowSection;
  /** For a composite (workflow.*) unit approval: who authorized vs. who executed. */
  attribution?: TraceCompositeAttribution;
  lineage: readonly { recordId: string; kind: string; occurredAt: string; subject?: string }[];
}

/** Dependencies (all existing ports plus the lineage repository). */
export interface DecisionTraceDependencies {
  approvals: ApprovalEngine;
  lineage: LineageRepository;
  agentExecutions?: AgentExecutionRecorder;
  workflowStepExecutions: WorkflowStepExecutionRepository;
  workflowInstances: WorkflowInstanceRepository;
  /** Optional trusted display-name resolver for the actors block (names only, never emails). */
  resolveUserName?: (userId: string) => Promise<string | undefined>;
  /** Whether a tool is read-only (its verification is not counted) — the workflow read model's input. */
  sideEffectOf?: (toolId: string) => SideEffectClass | undefined;
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

/** Builds decision traces. */
export class DecisionTraceService {
  readonly #deps: DecisionTraceDependencies;

  constructor(dependencies: DecisionTraceDependencies) {
    this.#deps = dependencies;
  }

  /** The trace of an audit event id (`apr:` / `agx:` / `wfs:`), or `undefined` when none exists in the tenant. */
  async trace(tenantId: string, eventId: string): Promise<DecisionTraceDto | undefined> {
    const [prefix, ...rest] = eventId.split(':');
    const id = rest.join(':');
    let approval: ApprovalRequestRecord | undefined;
    const runIds = new Set<string>();
    let requestText: string | undefined;
    let workspaceId: string | undefined;
    let actorId: string | undefined;
    let approvalId: string | undefined;
    let workflowInstance: WorkflowInstance | undefined;

    if (prefix === 'apr') {
      const found = await this.#deps.approvals.byId(id);
      if (found === undefined || found.tenantId !== tenantId) {
        return undefined;
      }
      approval = found;
      approvalId = found.id;
      runIds.add(found.runId);
      requestText = found.intent;
      workspaceId = found.workspaceId;
      actorId = found.userId;
    } else if (prefix === 'agx' && this.#deps.agentExecutions !== undefined) {
      const rows = await this.#deps.agentExecutions.listByTenant(tenantId as TenantId, {
        limit: 500,
      });
      const record = rows.find((row) => row.id === id);
      if (record === undefined) {
        return undefined;
      }
      if (record.runId !== undefined) runIds.add(record.runId);
      approvalId = record.approvalId;
      requestText = record.proposalAction;
      workspaceId = record.workspaceId;
      actorId = record.userId;
    } else if (prefix === 'wfs') {
      const step = await this.#deps.workflowStepExecutions.findById(id);
      const instance =
        step === undefined
          ? undefined
          : await this.#deps.workflowInstances.findById(step.workflowId);
      if (instance === undefined || instance.tenantId !== tenantId) {
        return undefined;
      }
      workflowInstance = instance;
      runIds.add(instance.correlationId);
      approvalId = instance.approvalId;
      workspaceId = instance.workspaceId;
      actorId = instance.userId;
    } else {
      return undefined;
    }

    if (approvalId !== undefined && approval === undefined) {
      const linked = await this.#deps.approvals.byId(approvalId);
      if (linked !== undefined && linked.tenantId === tenantId) {
        approval = linked;
        runIds.add(linked.runId);
        requestText ??= linked.intent;
      }
    }

    // A composite (workflow.*) unit approval: find the instance it started (tenant-scoped scan).
    if (workflowInstance === undefined && approval !== undefined && isWorkflowApproval(approval)) {
      const unit = approval;
      workflowInstance = (
        await this.#deps.workflowInstances.listByTenant(tenantId as TenantId, 500)
      ).find((candidate) => candidate.tenantId === tenantId && candidate.approvalId === unit.id);
    }
    if (workflowInstance !== undefined) runIds.add(workflowInstance.correlationId);

    const byId = new Map<string, LineageRecord>();
    for (const runId of runIds) {
      for (const record of await this.#deps.lineage.list(tenantId, { runId }))
        byId.set(record.id, record);
    }
    if (approvalId !== undefined) {
      for (const record of await this.#deps.lineage.list(tenantId, { approvalId }))
        byId.set(record.id, record);
    }
    // Follow LINK edges (one hop): a remediation plan/step or similar parent
    // names the run(s) whose executions belong to it.
    for (const record of [...byId.values()]) {
      const linked =
        record.kind === 'LINK'
          ? asString((record.data as Record<string, unknown>)['runId'])
          : undefined;
      if (linked !== undefined && !runIds.has(linked)) {
        runIds.add(linked);
        for (const extra of await this.#deps.lineage.list(tenantId, { runId: linked }))
          byId.set(extra.id, extra);
      }
    }
    const records = [...byId.values()].sort(
      (a, b) =>
        a.occurredAt.localeCompare(b.occurredAt) || a.seq - b.seq || a.id.localeCompare(b.id),
    );

    const approvedFingerprint =
      approval === undefined ? undefined : fingerprintOf(approval.input ?? {});
    const evidence: TraceEvidence[] = [];
    const planned: DecisionTraceDto['planned'][number][] = [];
    const executions: DecisionTraceDto['executions'][number][] = [];
    const verifications = verificationByInvocation(records);
    for (const record of records) {
      const d = record.data as Record<string, unknown>;
      switch (record.kind) {
        case 'EVIDENCE':
        case 'FINDING':
          evidence.push({
            evidenceId: record.id,
            sourceType: asString(d['sourceType']) ?? record.subjectType ?? 'UNKNOWN',
            sourceId: asString(d['sourceId']) ?? record.subjectId ?? '',
            ...(asString(d['title']) === undefined
              ? {}
              : { title: asString(d['title']) as string }),
            ...(d['sourceVersion'] === undefined
              ? {}
              : { version: d['sourceVersion'] as number | string }),
            ...(record.fingerprint === undefined ? {} : { fingerprint: record.fingerprint }),
            ...(asString(d['retrievedAt']) === undefined
              ? {}
              : { retrievedAt: asString(d['retrievedAt']) as string }),
            ...(asString(d['trust']) === undefined
              ? {}
              : { trust: asString(d['trust']) as string }),
            ...(asString(d['retrievalMethod']) === undefined
              ? {}
              : { retrievalMethod: asString(d['retrievalMethod']) as string }),
            ...(asString(d['connector']) === undefined
              ? {}
              : { connector: asString(d['connector']) as string }),
            derived: record.kind === 'FINDING' || d['derived'] === true,
            ...(record.invocationId === undefined ? {} : { invocationId: record.invocationId }),
          });
          break;
        case 'PLANNED_ACTION': {
          const policy = d['policy'] as { policyId?: string; version?: string } | undefined;
          planned.push({
            ...(asString(d['stepId']) === undefined
              ? {}
              : { stepId: asString(d['stepId']) as string }),
            ...(asString(d['capabilityId']) === undefined
              ? {}
              : { capabilityId: asString(d['capabilityId']) as string }),
            ...(asString(d['toolId']) === undefined
              ? {}
              : { toolId: asString(d['toolId']) as string }),
            ...(asString(d['inputFingerprint']) === undefined
              ? {}
              : { inputFingerprint: asString(d['inputFingerprint']) as string }),
            ...(typeof d['requiresApproval'] === 'boolean'
              ? { requiresApproval: d['requiresApproval'] }
              : {}),
            ...(record.approvalId === undefined ? {} : { approvalId: record.approvalId }),
            ...(policy?.policyId === undefined ? {} : { policyId: policy.policyId }),
            ...(policy?.version === undefined ? {} : { policyVersion: policy.version }),
          });
          break;
        }
        case 'EXECUTION': {
          const input = asString(d['inputFingerprint']);
          executions.push({
            ...(record.invocationId === undefined ? {} : { invocationId: record.invocationId }),
            ...(asString(d['toolId']) === undefined
              ? {}
              : { toolId: asString(d['toolId']) as string }),
            ...(asString(d['status']) === undefined
              ? {}
              : { status: asString(d['status']) as string }),
            ...(asString(d['origin']) === undefined
              ? {}
              : { origin: asString(d['origin']) as string }),
            ...(record.invocationId !== undefined && verifications.has(record.invocationId)
              ? {
                  verified: verifications.get(record.invocationId)?.verified as boolean,
                  verification: verifications.get(record.invocationId) as ExecutionVerificationDto,
                }
              : {}),
            ...(input === undefined ? {} : { inputFingerprint: input }),
            ...(asString(d['outputFingerprint']) === undefined
              ? {}
              : { outputFingerprint: asString(d['outputFingerprint']) as string }),
            ...(d['affectedResource'] === undefined
              ? {}
              : { affectedResource: d['affectedResource'] as { type: string; id: string } }),
            ...(asString(d['completedAt']) === undefined
              ? {}
              : { completedAt: asString(d['completedAt']) as string }),
            ...(record.approvalId === undefined ? {} : { approvalId: record.approvalId }),
            // An execution under an approval that recorded no input fingerprint
            // cannot be shown to match: it is reported as NOT matching. An INNER
            // workflow step is authorized by the unit approval as a whole (its
            // own input is derived from the approved input, never equal to it),
            // so the fingerprint comparison applies to the outer execution only.
            ...(record.approvalId !== undefined &&
            approvedFingerprint !== undefined &&
            d['workflow'] === undefined
              ? { matchesApprovedInput: input !== undefined && input === approvedFingerprint }
              : {}),
            ...(d['workflow'] === undefined
              ? {}
              : { workflow: d['workflow'] as { stepId?: string; purpose?: string } }),
          });
          break;
        }
        default:
          break;
      }
    }

    // Workflow section + composite attribution (read models over the journal,
    // the approval row and lineage — nothing is written or rewritten).
    const workflow =
      workflowInstance === undefined
        ? undefined
        : await this.#workflowSection(workflowInstance, records, approval);
    const compositeApproval =
      approval !== undefined && isWorkflowApproval(approval) ? approval : undefined;
    const linkedExecutions = executions.map((execution) => {
      const stepId = execution.workflow?.stepId;
      const forward = workflow?.steps.find(
        (step) => step.purpose === 'step' && step.stepId === stepId,
      );
      return {
        ...execution,
        ...(compositeApproval !== undefined &&
        execution.workflow !== undefined &&
        execution.approvalId === compositeApproval.id
          ? { compositeApproval: compositeLink(compositeApproval) }
          : {}),
        ...(execution.workflow?.purpose === 'step' && forward?.laterState !== undefined
          ? {
              laterState: forward.laterState,
              ...(forward.compensatedBy === undefined
                ? {}
                : { compensatedBy: forward.compensatedBy }),
            }
          : {}),
      };
    });

    const delegationIds = [
      ...new Set(records.map((r) => r.delegationId).filter((v): v is string => v !== undefined)),
    ];
    const agentId = approval?.agentId ?? records.find((r) => r.agentId !== undefined)?.agentId;
    return {
      eventId,
      request: {
        ...(requestText === undefined ? {} : { text: requestText.slice(0, 300) }),
        ...(actorId === undefined ? {} : { actorId }),
        organizationId: tenantId,
        ...(workspaceId === undefined ? {} : { workspaceId }),
        ...(runIds.size === 0 ? {} : { runId: [...runIds][0] as string }),
      },
      evidence,
      actors: await withActorNames(
        buildActors({
          requesterId: (approval?.userId ?? actorId) as string,
          ...(approval === undefined ? {} : { approval }),
          records,
          ...(agentId === undefined ? {} : { agentId }),
        }),
        this.#deps.resolveUserName,
      ),
      authorization: {
        ...(agentId === undefined ? {} : { agentId }),
        delegationIds:
          approval?.delegationId !== undefined && !delegationIds.includes(approval.delegationId)
            ? [approval.delegationId, ...delegationIds]
            : delegationIds,
        ...(asString((executions[0] as { origin?: string } | undefined)?.origin) === undefined
          ? {}
          : { origin: (executions[0] as { origin: string }).origin }),
      },
      ...policySection(approval, records),
      ...(approval === undefined
        ? {}
        : {
            approval: {
              id: approval.id,
              status: approval.status,
              ...(approval.decidedBy === undefined ? {} : { decidedBy: approval.decidedBy }),
              ...(approval.decidedAt === undefined ? {} : { decidedAt: approval.decidedAt }),
              requester: approval.userId,
              ...(approval.requiredApproverRoleId === undefined
                ? {}
                : { requiredApproverRoleId: approval.requiredApproverRoleId }),
              separationOfDuties: approval.separationOfDuties,
              expiresAt: approval.expiresAt,
              inputFingerprint: approvedFingerprint as string,
            },
          }),
      planned,
      executions: linkedExecutions,
      ...(workflow === undefined ? {} : { workflow }),
      ...(compositeApproval === undefined
        ? {}
        : { attribution: compositeAttribution(compositeApproval, records, executions) }),
      lineage: records.map((r) => ({
        recordId: r.id,
        kind: r.kind,
        occurredAt: r.occurredAt,
        ...(r.subjectId === undefined ? {} : { subject: `${r.subjectType ?? ''}:${r.subjectId}` }),
      })),
    };
  }

  /** The instance-state section: the read model's own derivation over the journal + run lineage. */
  async #workflowSection(
    instance: WorkflowInstance,
    lineage: readonly LineageRecord[],
    approval: ApprovalRequestRecord | undefined,
  ): Promise<TraceWorkflowSection> {
    const journal = await this.#deps.workflowStepExecutions.listByWorkflow(instance.id);
    const view = buildWorkflowRecordView({
      record: {
        instance: instance.toContract(),
        steps: journal.map((execution) => execution.toContract()),
      },
      lineage,
      sideEffectOf: this.#deps.sideEffectOf ?? (() => undefined),
      ...(approval === undefined ? {} : { approval }),
    });
    const compensations = view.steps.filter((step) => step.purpose === 'compensation');
    const outstanding = new Set(
      (view.instance.compensation?.outstanding ?? []).map((entry) => entry.stepId),
    );
    const steps: TraceWorkflowStep[] = view.steps.map((step) => {
      const base = {
        stepId: step.stepId,
        toolId: step.toolId,
        name: step.name,
        purpose: step.purpose,
        ...(step.compensatesStepId === undefined
          ? {}
          : { compensatesStepId: step.compensatesStepId }),
        status: step.status,
        ...((step.finishedAt ?? step.startedAt) === undefined
          ? {}
          : { executedAt: (step.finishedAt ?? step.startedAt) as string }),
        ...(step.errorCode === undefined ? {} : { errorCode: step.errorCode }),
      };
      if (step.purpose !== 'step' || step.status !== 'succeeded') return base;
      const undo = compensations.find((c) => c.compensatesStepId === step.stepId);
      if (undo?.status === 'succeeded') {
        return { ...base, laterState: 'compensated', compensatedBy: undo.stepId };
      }
      if (undo !== undefined) return { ...base, laterState: 'compensation_failed' };
      if (outstanding.has(step.stepId)) return { ...base, laterState: 'not_rolled_back' };
      return base;
    });
    return {
      instanceId: instance.id,
      state: view.instance.state,
      rollbackSummary: view.instance.rollbackSummary,
      steps,
      note: workflowNote(view.instance.state, steps),
    };
  }
}

/**
 * The policy section: the decision recorded ON the approval when it has one
 * (recorded, never recomputed); otherwise the decision recorded on the first
 * planned/executed lineage record (e.g. remediation, whose approvals do not
 * carry one).
 */
function policySection(
  approval: ApprovalRequestRecord | undefined,
  records: readonly LineageRecord[],
): Pick<DecisionTraceDto, 'policy'> {
  const contextFingerprint = records
    .map((r) => (r.data as { policy?: { contextFingerprint?: string } }).policy?.contextFingerprint)
    .find((value) => value !== undefined);
  if (approval?.policy !== undefined) {
    return {
      policy: {
        id: approval.policy.policyId,
        version: approval.policy.version,
        outcome: approval.policy.outcome,
        reason: approval.policy.reason,
        rules: approval.policy.rules,
        ...(contextFingerprint === undefined ? {} : { contextFingerprint }),
      },
    };
  }
  // Prefer the decision of the step THIS approval gated (records linked to the
  // approval); only then fall back to the first decision recorded on the run.
  const policyOf = (
    r: LineageRecord,
  ): { policyId?: string; version?: string; outcome?: string } | undefined =>
    (r.data as { policy?: { policyId?: string; version?: string; outcome?: string } }).policy;
  const linked =
    approval === undefined
      ? undefined
      : records.find((r) => r.approvalId === approval.id && policyOf(r)?.policyId !== undefined);
  const recorded =
    linked !== undefined
      ? policyOf(linked)
      : records.map(policyOf).find((policy) => policy?.policyId !== undefined);
  if (recorded?.policyId === undefined) {
    return {};
  }
  return {
    policy: {
      id: recorded.policyId,
      version: recorded.version ?? '',
      outcome: recorded.outcome ?? '',
      ...(contextFingerprint === undefined ? {} : { contextFingerprint }),
    },
  };
}

/** The link of an inner execution to the unit approval that authorized the composite. */
function compositeLink(approval: ApprovalRequestRecord): TraceCompositeApprovalLink {
  return {
    approvalId: approval.id,
    approvalScope: 'composite_workflow',
    ...(approvedByOf(approval) === undefined ? {} : { approvedBy: approvedByOf(approval) }),
    role: 'authorized_the_composite',
  };
}

/** The user who approved a unit approval (a rejection / expiry approves nothing). */
function approvedByOf(approval: ApprovalRequestRecord): string | undefined {
  return approval.decidedBy !== undefined &&
    approval.status !== 'rejected' &&
    approval.status !== 'expired'
    ? approval.decidedBy
    : undefined;
}

/**
 * The explicit authorized-vs-executed statement of a composite. The approver
 * authorized the unit; inner steps ran under the workflow instance within the
 * requester's ceiling. `approverExecutedSteps` is COMPUTED from lineage (never
 * asserted): true only if a record shows the distinct approver as the actor.
 */
function compositeAttribution(
  approval: ApprovalRequestRecord,
  records: readonly LineageRecord[],
  executions: readonly DecisionTraceDto['executions'][number][],
): TraceCompositeAttribution {
  const approvedBy = approvedByOf(approval);
  const inner = executions.filter(
    (execution) => execution.workflow !== undefined && execution.approvalId === approval.id,
  ).length;
  const approverExecutedSteps =
    approvedBy !== undefined &&
    approvedBy !== approval.userId &&
    records.some((record) => record.kind === 'EXECUTION' && record.actorId === approvedBy);
  return {
    approvalScope: 'composite_workflow',
    approvalId: approval.id,
    ...(approvedBy === undefined ? {} : { approvedBy }),
    innerExecutionAuthority: 'workflow_instance_under_requester_ceiling',
    approverExecutedSteps,
    innerExecutionCount: inner,
    statement:
      (approvedBy === undefined
        ? 'The unit approval has not authorized the composite workflow.'
        : 'The approval authorized the composite workflow as a unit.') +
      ' Its inner steps ran under the workflow instance, within the requester’s capability ceiling; ' +
      (approverExecutedSteps
        ? 'lineage shows the approver as an executing actor — this must be investigated.'
        : 'the approver did not execute any step.'),
  };
}

/** A deterministic, plain-language reading of the step / compensation timeline. */
function workflowNote(state: CompositeWorkflowState, steps: readonly TraceWorkflowStep[]): string {
  const nameOf = (stepId: string | undefined): string =>
    steps.find((step) => step.stepId === stepId)?.name ?? stepId ?? 'a step';
  const verb = (status: string): string => (status === 'succeeded' ? 'executed' : status);
  const phrases = steps.map((step) =>
    step.purpose === 'compensation'
      ? `compensation ${verb(step.status)} for ${nameOf(step.compensatesStepId)}`
      : `${step.name} ${verb(step.status)}${step.errorCode === undefined ? '' : ` (${step.errorCode})`}`,
  );
  const undone = steps.some((step) => step.laterState === 'compensated');
  return (
    `${phrases.length === 0 ? 'No step has run' : phrases.join('; ')}. ` +
    `Final workflow state: ${state.toUpperCase()}.` +
    (undone
      ? ' Steps that executed successfully were later undone by the compensation; their own recorded status is unchanged.'
      : '')
  );
}
