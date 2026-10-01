/**
 * @nexora/app-api — approval lifecycle audit events (Prompt 8).
 *
 * `approval.granted`, `approval.rejected` and `approval.expired` are
 * published ONCE per transition (the caller that observed the transition —
 * `decide` ok, or `expire`/`expireDue`/`decide` with `transitioned: true` —
 * is the only one that publishes). Projected into the audit activity feed by
 * the NotificationPolicy. Ids and classifications only: never the approved
 * arguments or any payload.
 */

import {
  createEventEnvelope,
  type EventEnvelope,
  type EventPublisher,
} from '@nexora/shared/events';
import type { ApprovalRequestRecord } from '@nexora/ai-runtime';

export const APPROVAL_GRANTED_EVENT = 'approval.granted';
export const APPROVAL_REJECTED_EVENT = 'approval.rejected';
export const APPROVAL_EXPIRED_EVENT = 'approval.expired';
/** An `executing` approval whose lease elapsed was failed by recovery (outcome unknown). */
export const APPROVAL_RECOVERY_REQUIRED_EVENT = 'approval.recovery_required';

/** The lifecycle transition being recorded. */
export type ApprovalLifecycleEventKind = 'granted' | 'rejected' | 'expired' | 'recovery_required';

/** Inputs of {@link publishApprovalLifecycleEvent}. */
export interface ApprovalLifecycleEventInput {
  kind: ApprovalLifecycleEventKind;
  /** The approval as it is after the transition (trusted server record). */
  approval: Pick<
    ApprovalRequestRecord,
    | 'id'
    | 'tenantId'
    | 'workspaceId'
    | 'userId'
    | 'capabilityId'
    | 'toolId'
    | 'runId'
    | 'expiresAt'
    | 'requiredApproverRoleId'
    | 'separationOfDuties'
  >;
  /** The deciding user (granted/rejected). Absent for an expiry (system). */
  decidedBy?: string;
}

/** The canonical envelope of an approval lifecycle transition. */
export function approvalLifecycleEvent(input: ApprovalLifecycleEventInput): EventEnvelope {
  const { approval } = input;
  const type =
    input.kind === 'granted'
      ? APPROVAL_GRANTED_EVENT
      : input.kind === 'rejected'
        ? APPROVAL_REJECTED_EVENT
        : input.kind === 'recovery_required'
          ? APPROVAL_RECOVERY_REQUIRED_EVENT
          : APPROVAL_EXPIRED_EVENT;
  return createEventEnvelope({
    type,
    version: 1,
    tenantId: approval.tenantId,
    ...(approval.workspaceId === undefined ? {} : { workspaceId: approval.workspaceId }),
    correlationId: approval.runId,
    actor:
      input.decidedBy === undefined
        ? {
            kind: 'system',
            id: input.kind === 'recovery_required' ? 'approval-recovery' : 'approval-expiry',
          }
        : { kind: 'user', id: input.decidedBy },
    payload: {
      approvalId: approval.id,
      organizationId: approval.tenantId,
      ...(approval.workspaceId === undefined ? {} : { workspaceId: approval.workspaceId }),
      requesterId: approval.userId,
      ...(input.decidedBy === undefined ? {} : { decidedBy: input.decidedBy }),
      capabilityId: approval.capabilityId,
      toolId: approval.toolId,
      expiresAt: approval.expiresAt,
      separationOfDuties: approval.separationOfDuties,
      ...(approval.requiredApproverRoleId === undefined
        ? {}
        : { requiredApproverRoleId: approval.requiredApproverRoleId }),
    },
    metadata: {
      version: 1,
      category: 'platform',
      priority: 'high',
      deliverySemantics: 'at_least_once',
    },
  });
}

/** Publishes one approval lifecycle event (call once per transition). */
export async function publishApprovalLifecycleEvent(
  publisher: EventPublisher,
  input: ApprovalLifecycleEventInput,
): Promise<void> {
  await publisher.publish([approvalLifecycleEvent(input)]);
}
