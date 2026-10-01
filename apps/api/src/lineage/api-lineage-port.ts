/**
 * @nexora/app-api — the API's {@link LineagePort} (Prompt 6).
 *
 * Converts runtime lineage events into append-only, tenant-scoped records:
 * a PLANNED_ACTION per planned step; per real execution an EXECUTION, its
 * separate VERIFICATION, and one EVIDENCE record per piece of provenance the
 * result carried. Records hold ids, versions, timestamps and fingerprints —
 * never raw outputs, secrets or reasoning. Nothing here is read by any
 * authorization path.
 */

import type { ExecutionEvent, LineagePort, PlannedActionEvent } from '@nexora/ai-runtime/execution';
import { DEFAULT_TOOL_VERIFICATION } from '@nexora/agent-sdk/tools';
import { prefixedId } from '@nexora/shared/ids';
import type {
  EvidenceData,
  ExecutionData,
  LineageRecord,
  LineageRepository,
  PlannedActionData,
  VerificationData,
} from '@nexora/module-lineage';
import { fingerprintOf } from '@nexora/module-lineage';

import { affectedResourceOf, extractEvidence } from './evidence-extractors.js';

/** Persists lineage for the events the runtime reports. */
export class ApiLineagePort implements LineagePort {
  readonly #repository: LineageRepository;
  #seq = 0;

  constructor(repository: LineageRepository) {
    this.#repository = repository;
  }

  async planned(event: PlannedActionEvent): Promise<void> {
    const data: PlannedActionData = {
      capabilityId: event.capabilityId,
      toolId: event.toolId,
      stepId: event.stepId,
      inputFingerprint: event.inputFingerprint,
      requiresApproval: event.requiresApproval,
      ...(event.policy === undefined ? {} : { policy: event.policy }),
      ...(event.approvedBy === undefined ? {} : { approvedBy: event.approvedBy }),
    };
    await this.#repository.append([
      this.#base(event, 'PLANNED_ACTION', new Date().toISOString(), {
        subjectType: 'tool',
        subjectId: event.toolId,
        fingerprint: event.inputFingerprint,
        data: { ...data, origin: event.origin },
      }),
    ]);
  }

  async executed(event: ExecutionEvent): Promise<void> {
    const at = event.completedAt;
    const execution: ExecutionData = {
      capabilityId: event.capabilityId,
      toolId: event.toolId,
      origin: event.origin,
      status: event.status,
      ...(event.errorCode === undefined ? {} : { errorCode: event.errorCode }),
      attempts: event.attempts,
      startedAt: event.startedAt,
      completedAt: event.completedAt,
      inputFingerprint: event.inputFingerprint,
      ...(event.outputFingerprint === undefined
        ? {}
        : { outputFingerprint: event.outputFingerprint }),
      ...(affectedResourceOf(event.output) === undefined
        ? {}
        : { affectedResource: affectedResourceOf(event.output) as { type: string; id: string } }),
      ...(event.policy === undefined ? {} : { policy: event.policy }),
      ...(event.workflow === undefined ? {} : { workflow: event.workflow }),
      ...(event.approvedBy === undefined ? {} : { approvedBy: event.approvedBy }),
    };
    // The verification source is the tool's DECLARED one (the executor fills
    // `event.verification` from the manifest); a tool that declared nothing —
    // or an event without detail — is recorded as the handler's own report.
    const declared = event.verification ?? {
      verified: event.verified,
      source: DEFAULT_TOOL_VERIFICATION.source,
      limitation: DEFAULT_TOOL_VERIFICATION.limitation,
      checks: undefined,
    };
    const verification: VerificationData = {
      of: event.invocationId,
      verified: event.verified,
      method: declared.source,
      source: declared.source,
      ...(declared.limitation === undefined ? {} : { limitation: declared.limitation }),
      ...(declared.checks === undefined ? {} : { checks: declared.checks }),
    };
    const extracted = extractEvidence(event);
    const records: LineageRecord[] = [
      this.#base(event, 'EXECUTION', at, {
        invocationId: event.invocationId,
        subjectType: 'tool',
        subjectId: event.toolId,
        fingerprint: fingerprintOf(execution),
        data: {
          ...execution,
          ...(extracted.droppedOutOfScope > 0
            ? { evidenceDroppedOutOfScope: extracted.droppedOutOfScope }
            : {}),
        },
      }),
      this.#base(event, 'VERIFICATION', at, {
        invocationId: event.invocationId,
        subjectType: 'tool',
        subjectId: event.toolId,
        fingerprint: fingerprintOf(verification),
        data: { ...verification },
      }),
      ...extracted.items.map((item) => {
        const data: EvidenceData = {
          sourceType: item.sourceType,
          sourceId: item.sourceId,
          ...(item.title === undefined ? {} : { title: item.title }),
          ...(item.sourceVersion === undefined ? {} : { sourceVersion: item.sourceVersion }),
          ...(item.sourceUpdatedAt === undefined ? {} : { sourceUpdatedAt: item.sourceUpdatedAt }),
          retrievedAt: at,
          trust: item.trust,
          retrievalMethod: `tool:${event.toolId}`,
          toolId: event.toolId,
          ...(item.connector === undefined ? {} : { connector: item.connector }),
        };
        return this.#base(event, 'EVIDENCE', at, {
          invocationId: event.invocationId,
          subjectType: item.sourceType,
          subjectId: item.sourceId,
          fingerprint: item.fingerprint,
          data: { ...data },
        });
      }),
    ];
    await this.#repository.append(records);
  }

  #base(
    scope: PlannedActionEvent | ExecutionEvent,
    kind: LineageRecord['kind'],
    occurredAt: string,
    rest: Pick<LineageRecord, 'data'> &
      Partial<Pick<LineageRecord, 'invocationId' | 'subjectType' | 'subjectId' | 'fingerprint'>>,
  ): LineageRecord {
    this.#seq += 1;
    return {
      id: prefixedId('lin'),
      tenantId: scope.tenantId,
      ...(scope.workspaceId === undefined ? {} : { workspaceId: scope.workspaceId }),
      runId: scope.runId,
      kind,
      occurredAt,
      seq: this.#seq,
      actorId: scope.userId,
      ...(scope.agent === undefined ? {} : { agentId: scope.agent.agentId }),
      ...(scope.delegationId === undefined ? {} : { delegationId: scope.delegationId }),
      ...(scope.approvalId === undefined ? {} : { approvalId: scope.approvalId }),
      ...rest,
    };
  }
}
