/**
 * @nexora/domain-hr — hiring-requisition domain events.
 *
 * Every step of the requisition chain is an event on the canonical envelope
 * (category `hr`), scoped to the organization and the requesting workspace.
 */

import { createEventEnvelope, type EventActor, type EventEnvelope } from '@nexora/shared/events';
import type { TenantId, WorkspaceId } from '@nexora/contracts/common';

/** HR is the owning bounded context (same category as the employee events). */
const HR_EVENT_CATEGORY = 'hr' as const;

/** Stable event type names of the requisition chain. */
export const REQUISITION_EVENT_TYPES = {
  submitted: 'hiring.requisition.submitted',
  stageApproved: 'hiring.requisition.stage_approved',
  approved: 'hiring.requisition.approved',
  changesRequested: 'hiring.requisition.changes_requested',
  resubmitted: 'hiring.requisition.resubmitted',
  withdrawn: 'hiring.requisition.withdrawn',
} as const;

/** Context required to emit a requisition event. */
export interface RequisitionEventContext {
  /** The actor that caused the event. */
  actor: EventActor;
  /** Correlation id of the originating request. */
  correlationId: string;
  /** The owning organization (tenant) id. */
  organizationId: TenantId;
}

/** Payload carried by every requisition event. */
export interface RequisitionEventPayload {
  requisitionId: string;
  organizationId: TenantId;
  workspaceId: WorkspaceId;
  requestedBy: string;
  jobTitle: string;
  headcount: number;
  status: string;
  round: number;
  /** The stage a decision event belongs to. */
  stage?: string;
}

/** Creates a requisition event envelope. */
export function requisitionEvent(
  type: string,
  context: RequisitionEventContext,
  workspaceId: WorkspaceId,
  payload: RequisitionEventPayload,
): EventEnvelope<RequisitionEventPayload> {
  return createEventEnvelope({
    type,
    version: 1,
    actor: context.actor,
    correlationId: context.correlationId,
    tenantId: context.organizationId,
    workspaceId,
    payload,
    metadata: {
      version: 1,
      category: HR_EVENT_CATEGORY,
      priority: 'normal',
      deliverySemantics: 'at_least_once',
    },
  });
}
