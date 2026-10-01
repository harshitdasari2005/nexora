/**
 * @nexora/app-api — approval governance helpers (Prompt 8).
 *
 * Shared by the decision route, the inbound-email decision path and the
 * pending-approvals list:
 * - {@link approvalRefusalReasonCode}: refusal → stable audit reason code;
 * - {@link createApprovalLifecycle}: publishes lifecycle audit events and
 *   sweeps due approvals (idempotent: each transition is published ONCE —
 *   only the call whose `expire`/`expireDue`/`decide` reported
 *   `transitioned` publishes);
 * - {@link toApprovalGovernanceDto}: the server-computed pending-approval DTO
 *   (`canDecide` comes from the SAME `authorizeApprovalDecision`, never from
 *   the UI).
 */

import type { ApprovalEngine, ApprovalRequestRecord } from '@nexora/ai-runtime';
import type { SecurityReasonCode } from '@nexora/ai-runtime/execution';
import type { EventPublisher } from '@nexora/shared/events';

import type { ApprovalDecisionRefusal } from './approval-authorization.js';
import {
  publishApprovalLifecycleEvent,
  type ApprovalLifecycleEventInput,
} from './approval-lifecycle-events.js';

/** Maps a decision refusal onto the audited security reason code. */
export function approvalRefusalReasonCode(refusal: ApprovalDecisionRefusal): SecurityReasonCode {
  switch (refusal) {
    case 'CAPABILITY_NOT_PERMITTED':
      return 'CAPABILITY_NOT_PERMITTED';
    case 'WRONG_APPROVER_ROLE':
      return 'WRONG_APPROVER_ROLE';
    case 'SELF_APPROVAL_FORBIDDEN':
      return 'SELF_APPROVAL_FORBIDDEN';
    case 'APPROVAL_EXPIRED':
      return 'APPROVAL_EXPIRED';
    default:
      return 'APPROVAL_DECISION_NOT_PERMITTED';
  }
}

/** Lifecycle publishing + expiry sweeping bound to one engine + publisher. */
export interface ApprovalLifecycle {
  /** Publishes one lifecycle event (call once per transition). */
  publish(input: ApprovalLifecycleEventInput): Promise<void>;
  /**
   * Sweeps every due approval (`engine.expireDue()`) and publishes
   * `approval.expired` once per record that transitioned in this call.
   * Idempotent and deterministic under the engine's injected clock; safe to
   * call periodically and lazily from routes. Returns the transitioned
   * records.
   */
  sweepExpiredApprovals(): Promise<readonly ApprovalRequestRecord[]>;
  /**
   * Recovers abandoned executions (`engine.recoverStale()`): an approval still
   * `executing` past its lease is failed `RECOVERY_REQUIRED` (NEVER
   * re-executed) and `approval.recovery_required` is published once per
   * record that transitioned in this call. Idempotent; lazy like the expiry
   * sweep. Returns the transitioned records.
   */
  sweepStaleExecutions(): Promise<readonly ApprovalRequestRecord[]>;
  /** Both sweeps (expiry, then stale-execution recovery). */
  sweepApprovals(): Promise<void>;
}

/** Builds the {@link ApprovalLifecycle} of an engine + publisher. */
export function createApprovalLifecycle(
  approvals: ApprovalEngine,
  publisher: EventPublisher,
): ApprovalLifecycle {
  const lifecycle: ApprovalLifecycle = {
    publish: (input) => publishApprovalLifecycleEvent(publisher, input),
    async sweepExpiredApprovals() {
      const transitioned = await approvals.expireDue();
      for (const approval of transitioned) {
        await publishApprovalLifecycleEvent(publisher, { kind: 'expired', approval });
      }
      return transitioned;
    },
    async sweepStaleExecutions() {
      const recovered = await approvals.recoverStale();
      for (const approval of recovered) {
        await publishApprovalLifecycleEvent(publisher, { kind: 'recovery_required', approval });
      }
      return recovered;
    },
    async sweepApprovals() {
      await lifecycle.sweepExpiredApprovals();
      await lifecycle.sweepStaleExecutions();
    },
  };
  return lifecycle;
}

/** The pending-approval DTO the Approvals page renders. */
export interface ApprovalGovernanceDto {
  id: string;
  capabilityId: string;
  toolId: string;
  requesterId: string;
  requesterName?: string;
  status: string;
  createdAt: string;
  expiresAt: string;
  requiredApproverRoleId?: string;
  separationOfDuties: boolean;
  policy?: { policyId: string; version: string; outcome: string };
  reason: string;
  /** Computed server-side by `authorizeApprovalDecision` for the caller. */
  canDecide: boolean;
  /** Why the caller cannot decide (stable refusal code), when `canDecide` is false. */
  denyReason?: string;
}

/** Builds one {@link ApprovalGovernanceDto} (no arguments/payload leave the server here). */
export function toApprovalGovernanceDto(
  approval: ApprovalRequestRecord,
  decision: { canDecide: boolean; denyReason?: string },
  requesterName?: string,
): ApprovalGovernanceDto {
  return {
    id: approval.id,
    capabilityId: approval.capabilityId,
    toolId: approval.toolId,
    requesterId: approval.userId,
    ...(requesterName === undefined ? {} : { requesterName }),
    status: approval.status,
    createdAt: approval.createdAt,
    expiresAt: approval.expiresAt,
    ...(approval.requiredApproverRoleId === undefined
      ? {}
      : { requiredApproverRoleId: approval.requiredApproverRoleId }),
    separationOfDuties: approval.separationOfDuties,
    ...(approval.policy === undefined
      ? {}
      : {
          policy: {
            policyId: approval.policy.policyId,
            version: approval.policy.version,
            outcome: approval.policy.outcome,
          },
        }),
    reason: approval.reason,
    canDecide: decision.canDecide,
    ...(decision.denyReason === undefined ? {} : { denyReason: decision.denyReason }),
  };
}
