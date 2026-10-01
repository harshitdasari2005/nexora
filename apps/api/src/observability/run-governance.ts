/**
 * @nexora/app-api — the governance block of a runtime run (Prompt 9).
 *
 * Joins, SERVER-SIDE and tenant-scoped, the recorded run with the approval row
 * and the run's lineage EXECUTION + VERIFICATION records so an operator can
 * answer "who initiated / which agent / which policy / was approval required /
 * who approved / what was approved / what executed / was it verified (and how)
 * / where did it fail" from one response. It is a read model: it stores and
 * decides nothing, is never consulted by authorization, and NEVER exposes raw
 * input or output — only ids, statuses and sha256 fingerprints.
 */

import type { ApprovalEngine } from '@nexora/ai-runtime';
import { fingerprintOf, type LineageRecord, type LineageRepository } from '@nexora/module-lineage';
import type { PolicyCall, RuntimeRun } from '@nexora/module-observability';

import {
  buildActors,
  verificationByInvocation,
  withActorNames,
  type ExecutionVerificationDto,
  type GovernanceActors,
} from '../audit/governance-actors.js';

/** The joined governance view of one run. */
export interface RunGovernanceDto {
  actors: GovernanceActors;
  approval?: {
    id: string;
    status: string;
    requesterId: string;
    approverId?: string;
    requiredApproverRoleId?: string;
    separationOfDuties: boolean;
    decidedAt?: string;
    expiresAt: string;
    /** sha256 of the exact arguments that were approved (the stored approval input). */
    approvedInputFingerprint: string;
  };
  policies: readonly PolicyCall[];
  executions: readonly {
    invocationId: string;
    toolId?: string;
    status?: string;
    inputFingerprint?: string;
    /** Under an approval: did what ran use exactly the approved arguments? */
    matchesApproved?: boolean;
    verification: ExecutionVerificationDto;
  }[];
  links: { auditEventId: string | null };
}

/** Ports the join needs. */
export interface RunGovernanceDependencies {
  approvals: ApprovalEngine;
  lineage: LineageRepository;
  /** Optional trusted display-name resolver for the actors block. */
  resolveUserName?: (userId: string) => Promise<string | undefined>;
}

/** Builds the governance block for a run (tenant-scoped on every read). */
export async function buildRunGovernance(
  dependencies: RunGovernanceDependencies,
  tenantId: string,
  run: RuntimeRun,
): Promise<RunGovernanceDto> {
  const approvalId = run.approval?.approvalId ?? run.tools.find((t) => t.approvalId)?.approvalId;
  const found =
    approvalId === undefined ? undefined : await dependencies.approvals.byId(approvalId);
  // A foreign-tenant approval id is indistinguishable from a missing one.
  const approval = found !== undefined && found.tenantId === tenantId ? found : undefined;

  const byId = new Map<string, LineageRecord>();
  for (const record of await dependencies.lineage.list(tenantId, { runId: run.id })) {
    byId.set(record.id, record);
  }
  if (approval !== undefined) {
    for (const record of await dependencies.lineage.list(tenantId, { approvalId: approval.id })) {
      byId.set(record.id, record);
    }
  }
  const records = [...byId.values()].sort(
    (a, b) => a.occurredAt.localeCompare(b.occurredAt) || a.seq - b.seq,
  );
  const verifications = verificationByInvocation(records);
  const approvedFingerprint =
    approval === undefined ? undefined : fingerprintOf(approval.input ?? {});

  const executions = records
    .filter((r) => r.kind === 'EXECUTION' && r.invocationId !== undefined)
    .map((r) => {
      const d = r.data as Record<string, unknown>;
      const inputFingerprint =
        typeof d['inputFingerprint'] === 'string' ? d['inputFingerprint'] : undefined;
      const invocationId = r.invocationId as string;
      return {
        invocationId,
        ...(typeof d['toolId'] === 'string' ? { toolId: d['toolId'] } : {}),
        ...(typeof d['status'] === 'string' ? { status: d['status'] } : {}),
        ...(inputFingerprint === undefined ? {} : { inputFingerprint }),
        ...(r.approvalId !== undefined && approvedFingerprint !== undefined
          ? { matchesApproved: inputFingerprint === approvedFingerprint }
          : {}),
        verification: verifications.get(invocationId) ?? {
          verified: false,
          source: 'handler_result',
          limitation: 'no verification record was found for this execution',
        },
      };
    });

  return {
    actors: await withActorNames(
      buildActors({
        requesterId: run.actorId,
        ...(approval === undefined ? {} : { approval }),
        records,
        ...(run.agentId === undefined ? {} : { agentId: run.agentId }),
        ...(run.delegationId === undefined ? {} : { delegationId: run.delegationId }),
      }),
      dependencies.resolveUserName,
    ),
    ...(approval === undefined
      ? {}
      : {
          approval: {
            id: approval.id,
            status: approval.status,
            requesterId: approval.userId,
            ...(approval.decidedBy === undefined ? {} : { approverId: approval.decidedBy }),
            ...(approval.requiredApproverRoleId === undefined
              ? {}
              : { requiredApproverRoleId: approval.requiredApproverRoleId }),
            separationOfDuties: approval.separationOfDuties,
            ...(approval.decidedAt === undefined ? {} : { decidedAt: approval.decidedAt }),
            expiresAt: approval.expiresAt,
            approvedInputFingerprint: approvedFingerprint as string,
          },
        }),
    policies: run.policies,
    executions,
    links: { auditEventId: approval === undefined ? null : `apr:${approval.id}` },
  };
}
