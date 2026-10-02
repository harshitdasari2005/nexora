/**
 * @nexora/domain-hr — recruiting domain events (job openings and candidates).
 *
 * Payloads carry ids, the role title and the stage only — never a candidate's
 * contact details or an offer amount (events feed the activity/audit trail,
 * which is readable more widely than recruiting records).
 */

import { createEventEnvelope, type EventActor, type EventEnvelope } from '@nexora/shared/events';
import type { TenantId, WorkspaceId } from '@nexora/contracts/common';

/** Stable event type names. */
export const RECRUITING_EVENT_TYPES = {
  openingOpened: 'recruiting.opening.opened',
  openingStatusChanged: 'recruiting.opening.status_changed',
  openingFilled: 'recruiting.opening.filled',
  candidateAdded: 'recruiting.candidate.added',
  candidateStageChanged: 'recruiting.candidate.stage_changed',
  feedbackRecorded: 'recruiting.candidate.feedback_recorded',
  offerExtended: 'recruiting.offer.extended',
  offerAccepted: 'recruiting.offer.accepted',
  offerDeclined: 'recruiting.offer.declined',
} as const;

/** Context required to emit a recruiting event. */
export interface RecruitingEventContext {
  actor: EventActor;
  correlationId: string;
  organizationId: TenantId;
}

/** Creates a recruiting event envelope (category `hr`). */
export function recruitingEvent(
  type: string,
  context: RecruitingEventContext,
  workspaceId: WorkspaceId,
  payload: Record<string, unknown>,
): EventEnvelope<Record<string, unknown>> {
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
      category: 'hr',
      priority: 'normal',
      deliverySemantics: 'at_least_once',
    },
  });
}
