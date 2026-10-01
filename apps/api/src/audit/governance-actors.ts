/**
 * @nexora/app-api — governance read-model helpers shared by the decision trace
 * (Audit Center) and the runtime-ops run detail (Prompt 9).
 *
 * Both answer "who requested, which agent, who approved, who executed, under
 * what authority, and was it verified?" from records written when things
 * happened (approval rows + append-only lineage). Nothing here is consulted by
 * any authorization path. The approver is DESCRIPTIVE: they never appear as
 * the actor or the executor — the requester (or the agent acting for the
 * requester) executes.
 */

import type { ApprovalRequestRecord } from '@nexora/ai-runtime';
import { DEFAULT_TOOL_VERIFICATION } from '@nexora/agent-sdk/tools';
import type { LineageRecord } from '@nexora/module-lineage';

/** Who was involved in one governed action. */
export interface GovernanceActors {
  requester: { userId: string; name?: string };
  agent?: { agentId: string; delegationId?: string };
  approver?: { userId: string; name?: string; roleId?: string; decidedAt: string };
  executor: { kind: 'user' | 'agent'; userId: string; agentId?: string };
  /** Which authority bounded the execution. */
  executionAuthority: 'requester_rbac' | 'agent_delegation';
}

/** How an execution was verified (declared source, never overstated). */
export interface ExecutionVerificationDto {
  verified: boolean;
  source: string;
  limitation?: string;
  checks?: readonly { ruleId: string; passed: boolean }[];
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

/**
 * The verification of each invocation, from its VERIFICATION lineage records.
 * Records written before the source field existed fall back to the honest
 * default (`handler_result` + its limitation).
 */
export function verificationByInvocation(
  records: readonly LineageRecord[],
): Map<string, ExecutionVerificationDto> {
  const out = new Map<string, ExecutionVerificationDto>();
  for (const record of records) {
    if (record.kind !== 'VERIFICATION') continue;
    const d = record.data as Record<string, unknown>;
    const of = asString(d['of']) ?? record.invocationId;
    if (of === undefined) continue;
    const source = asString(d['source']);
    const limitation =
      asString(d['limitation']) ??
      (source === undefined ? DEFAULT_TOOL_VERIFICATION.limitation : undefined);
    const checks = Array.isArray(d['checks'])
      ? (d['checks'] as { ruleId: string; passed: boolean }[])
      : undefined;
    out.set(of, {
      verified: d['verified'] === true,
      source: source ?? DEFAULT_TOOL_VERIFICATION.source,
      ...(limitation === undefined ? {} : { limitation }),
      ...(checks === undefined ? {} : { checks }),
    });
  }
  return out;
}

/**
 * Assembles the actors block. `requesterId` is the run/approval principal (the
 * actor recorded on lineage); the approver comes ONLY from the approval row's
 * `decidedBy` (falling back to the descriptive `approvedBy` on lineage).
 */
export function buildActors(input: {
  requesterId: string;
  approval?: ApprovalRequestRecord;
  records: readonly LineageRecord[];
  agentId?: string;
  delegationId?: string;
}): GovernanceActors {
  const { approval, records } = input;
  const agentId = input.agentId ?? approval?.agentId ?? records.find((r) => r.agentId)?.agentId;
  const delegationId =
    input.delegationId ??
    approval?.delegationId ??
    records.find((r) => r.delegationId)?.delegationId;
  let approver: GovernanceActors['approver'];
  if (approval?.decidedBy !== undefined) {
    approver = { userId: approval.decidedBy, decidedAt: approval.decidedAt ?? '' };
  } else if (approval === undefined || approval.decidedBy === undefined) {
    // No approval row (or undecided): fall back to what lineage described.
    const described = records
      .map(
        (r) =>
          (r.data as { approvedBy?: { userId: string; roleId?: string; decidedAt?: string } })
            .approvedBy,
      )
      .find((value) => value !== undefined);
    if (described !== undefined) {
      approver = {
        userId: described.userId,
        ...(described.roleId === undefined ? {} : { roleId: described.roleId }),
        decidedAt: described.decidedAt ?? '',
      };
    }
  }
  if (approver !== undefined && approval?.requiredApproverRoleId !== undefined) {
    approver = { ...approver, roleId: approval.requiredApproverRoleId };
  }
  return {
    requester: { userId: input.requesterId },
    ...(agentId === undefined
      ? {}
      : { agent: { agentId, ...(delegationId === undefined ? {} : { delegationId }) } }),
    ...(approver === undefined ? {} : { approver }),
    executor:
      agentId === undefined
        ? { kind: 'user', userId: input.requesterId }
        : { kind: 'agent', userId: input.requesterId, agentId },
    executionAuthority: agentId === undefined ? 'requester_rbac' : 'agent_delegation',
  };
}

/**
 * Fills the optional display names (never identifiers, never emails) of the
 * requester and approver from a trusted resolver. A resolver failure leaves
 * the names off — the ids are the record.
 */
export async function withActorNames(
  actors: GovernanceActors,
  resolveUserName: ((userId: string) => Promise<string | undefined>) | undefined,
): Promise<GovernanceActors> {
  if (resolveUserName === undefined) return actors;
  const safe = async (userId: string): Promise<string | undefined> => {
    try {
      return await resolveUserName(userId);
    } catch {
      return undefined;
    }
  };
  const requesterName = await safe(actors.requester.userId);
  const approverName =
    actors.approver === undefined ? undefined : await safe(actors.approver.userId);
  return {
    ...actors,
    requester: {
      ...actors.requester,
      ...(requesterName === undefined ? {} : { name: requesterName }),
    },
    ...(actors.approver === undefined
      ? {}
      : {
          approver: {
            ...actors.approver,
            ...(approverName === undefined ? {} : { name: approverName }),
          },
        }),
  };
}
