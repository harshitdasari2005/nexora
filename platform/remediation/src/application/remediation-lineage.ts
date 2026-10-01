/**
 * @nexora/module-remediation — remediation lineage writer (Prompt 6).
 *
 * Records WHY a remediation was planned and how its steps connect to the
 * approvals and governed runs that carried them out. Evidence INFORMS; it
 * never grants authority: nothing recorded here is read by any policy,
 * approval or authorization decision. Records are append-only — evidence
 * taken at plan time is the historical basis of the decision and is never
 * rewritten when the underlying source later changes.
 *
 * Records hold ids, fingerprints and compact facts only (never a document
 * copy, a secret or model reasoning). The writer is best-effort: a lineage
 * failure must never break remediation.
 */

import { prefixedId } from '@nexora/shared/ids';
import { nowIso } from '@nexora/shared/time';
import type {
  BusinessProblemDto,
  ProblemEvidenceDto,
  SolutionCandidateDto,
} from '@nexora/contracts/detection';
import { fingerprintOf } from '@nexora/module-lineage';
import type {
  EvidenceData,
  EvidenceSourceType,
  EvidenceTrust,
  LineageRecord,
  LineageRepository,
} from '@nexora/module-lineage';

/** The most evidence items recorded for one plan basis (bounded). */
export const MAX_BASIS_EVIDENCE = 50;

/** The trusted scope + plan a lineage write is about. */
export interface RemediationLineageScope {
  tenantId: string;
  workspaceId?: string;
  userId: string;
  planId: string;
}

interface Mapped {
  sourceType: EvidenceSourceType;
  trust: EvidenceTrust;
  derived: boolean;
  connector?: string;
}

/** Maps a detection evidence item to an honest lineage source type + trust. */
function mapEvidence(item: ProblemEvidenceDto): Mapped {
  switch (item.entityType?.toLowerCase()) {
    case 'project':
      return { sourceType: 'PROJECT', trust: 'PERSISTED_BUSINESS_RECORD', derived: false };
    case 'employee':
      return { sourceType: 'EMPLOYEE', trust: 'PERSISTED_BUSINESS_RECORD', derived: false };
    case 'budget':
      return { sourceType: 'BUDGET', trust: 'PERSISTED_BUSINESS_RECORD', derived: false };
    default:
      break;
  }
  switch (item.source) {
    case 'knowledge':
      return { sourceType: 'KNOWLEDGE_ARTICLE', trust: 'KNOWLEDGE_CONTENT', derived: false };
    case 'documents':
      return { sourceType: 'DOCUMENT', trust: 'KNOWLEDGE_CONTENT', derived: false };
    case 'projects':
      return { sourceType: 'PROJECT', trust: 'PERSISTED_BUSINESS_RECORD', derived: false };
    case 'integrations':
      return {
        sourceType: 'EXTERNAL_CONNECTOR',
        trust: 'EXTERNAL_CONTENT',
        derived: false,
        connector: 'integrations',
      };
    default:
      // Detection / workflow snapshot facts are computed conclusions of the
      // investigation, not primary records.
      return { sourceType: 'INVESTIGATION', trust: 'SYSTEM_STATE', derived: true };
  }
}

/** Appends remediation lineage to the (append-only) repository. */
export class RemediationLineageWriter {
  readonly #repository: LineageRepository;
  #seq = 0;

  constructor(repository: LineageRepository) {
    this.#repository = repository;
  }

  /**
   * Records the basis of a plan (or re-plan): one EVIDENCE record per problem
   * evidence item (+ the grounding solution's source) and ONE derived FINDING
   * that lists them.
   */
  async recordBasis(
    scope: RemediationLineageScope,
    input: {
      problem: BusinessProblemDto;
      solution: SolutionCandidateDto;
      planVersion: number;
      trigger: 'CREATE' | 'REPLAN';
    },
  ): Promise<void> {
    try {
      const at = nowIso();
      const records: LineageRecord[] = [];
      const fingerprints: string[] = [];
      for (const item of input.problem.evidence.slice(0, MAX_BASIS_EVIDENCE)) {
        const mapped = mapEvidence(item);
        const sourceId = item.entityId ?? `${input.problem.id}:${item.id}`;
        const fingerprint = fingerprintOf({
          source: item.source,
          entityType: item.entityType ?? null,
          entityId: item.entityId ?? null,
          fact: item.fact,
          occurredAt: item.occurredAt ?? null,
        });
        fingerprints.push(fingerprint);
        const data: EvidenceData & { evidenceItemId: string; problemId: string } = {
          sourceType: mapped.sourceType,
          sourceId,
          ...(item.entityTitle === undefined ? {} : { title: item.entityTitle }),
          ...(item.occurredAt === undefined ? {} : { sourceUpdatedAt: item.occurredAt }),
          retrievedAt: at,
          trust: mapped.trust,
          retrievalMethod: `detection:${item.source}`,
          toolId: 'remediation.plan',
          ...(mapped.connector === undefined ? {} : { connector: mapped.connector }),
          ...(mapped.derived ? { derived: true } : {}),
          evidenceItemId: item.id,
          problemId: input.problem.id,
        };
        records.push(
          this.#record(scope, 'EVIDENCE', at, {
            subjectType: mapped.sourceType,
            subjectId: sourceId,
            fingerprint,
            data: { ...data },
          }),
        );
      }
      // The grounding solution's own source (e.g. the knowledge article).
      const reference = input.solution.reference;
      if (reference !== undefined) {
        const sourceType: EvidenceSourceType =
          input.solution.source === 'documents' ? 'DOCUMENT' : 'KNOWLEDGE_ARTICLE';
        const fingerprint = fingerprintOf({
          solutionId: input.solution.id,
          source: input.solution.source,
          referenceId: reference.id,
          title: reference.title,
          requiredCapabilities: [...input.solution.requiredCapabilities],
        });
        fingerprints.push(fingerprint);
        const data: EvidenceData & { solutionId: string; problemId: string } = {
          sourceType,
          sourceId: reference.id,
          title: reference.title,
          retrievedAt: at,
          trust: 'KNOWLEDGE_CONTENT',
          retrievalMethod: 'detection:solution-discovery',
          toolId: 'remediation.plan',
          solutionId: input.solution.id,
          problemId: input.problem.id,
        };
        records.push(
          this.#record(scope, 'EVIDENCE', at, {
            subjectType: sourceType,
            subjectId: reference.id,
            fingerprint,
            data: { ...data },
          }),
        );
      }
      const evidenceFingerprint = fingerprintOf([...fingerprints].sort());
      records.push(
        this.#record(scope, 'FINDING', at, {
          subjectType: 'REMEDIATION_BASIS',
          subjectId: scope.planId,
          fingerprint: evidenceFingerprint,
          data: {
            problemId: input.problem.id,
            signalId: input.problem.signalId,
            groundedSolutionId: input.solution.id,
            evidenceRecordIds: records.map((record) => record.id),
            evidenceFingerprint,
            planVersion: input.planVersion,
            trigger: input.trigger,
            derived: true,
          },
        }),
      );
      await this.#repository.append(records);
    } catch {
      // Best-effort: lineage never blocks or alters remediation.
    }
  }

  /** Records a step ↔ approval / step ↔ governed-run edge. */
  async recordLink(
    scope: RemediationLineageScope,
    input: {
      stepId: string;
      problemId: string;
      relation: 'STEP_APPROVAL' | 'STEP_RUN';
      approvalId?: string;
      /** The orchestrator run id (= the ToolExecutor invocation runId) of an execution. */
      executionRunId?: string;
    },
  ): Promise<void> {
    try {
      const at = nowIso();
      await this.#repository.append([
        this.#record(scope, 'LINK', at, {
          subjectType: 'REMEDIATION_STEP',
          subjectId: `${scope.planId}:${input.stepId}`,
          ...(input.approvalId === undefined ? {} : { approvalId: input.approvalId }),
          data: {
            planId: scope.planId,
            stepId: input.stepId,
            problemId: input.problemId,
            ...(input.executionRunId === undefined ? {} : { runId: input.executionRunId }),
            ...(input.approvalId === undefined ? {} : { approvalId: input.approvalId }),
            relation: input.relation,
          },
        }),
      ]);
    } catch {
      // Best-effort.
    }
  }

  #record(
    scope: RemediationLineageScope,
    kind: LineageRecord['kind'],
    occurredAt: string,
    rest: Pick<LineageRecord, 'data'> &
      Partial<Pick<LineageRecord, 'subjectType' | 'subjectId' | 'fingerprint' | 'approvalId'>>,
  ): LineageRecord {
    this.#seq += 1;
    return {
      id: prefixedId('lin'),
      tenantId: scope.tenantId,
      ...(scope.workspaceId === undefined ? {} : { workspaceId: scope.workspaceId }),
      runId: scope.planId,
      kind,
      occurredAt,
      seq: this.#seq,
      actorId: scope.userId,
      ...rest,
    };
  }
}
