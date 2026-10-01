/**
 * @nexora/app-api — security decision audit sink.
 *
 * Turns every AI Runtime security block ({@link SecurityDecision}) into one
 * canonical `ai.security.blocked` event on the platform event stream. The
 * notification policy projects it into the workspace activity feed — an
 * EXISTING journal the Audit Center already reads — so blocked AI actions are
 * visible in the audit trail with no new table.
 *
 * Payload = structured decision metadata only (actor, origin/agent,
 * invocation id, organization, workspace, tool, capability, action, policy
 * decision, reason code, safe reason, outcome). Never argument values,
 * secrets, credentials, raw model output, or chain-of-thought.
 */

import { createEventEnvelope, type EventPublisher } from '@nexora/shared/events';
import type { SecurityDecision, SecurityDecisionSink } from '@nexora/ai-runtime/execution';
import { policyIdForReason } from '@nexora/module-policy';

/** The event type of a blocked AI action. */
export const AI_SECURITY_BLOCKED_EVENT = 'ai.security.blocked';

/** Builds the sink that publishes security decisions (best-effort). */
export function createSecurityAuditSink(publisher: EventPublisher): SecurityDecisionSink {
  return async (decision: SecurityDecision) => {
    await publisher.publish([securityBlockedEvent(decision)]);
  };
}

/** The canonical event envelope of a security decision. */
export function securityBlockedEvent(decision: SecurityDecision) {
  // Every block names the stable policy it enforces: the engine's own
  // decisions carry theirs; earlier layers (delegation, argument guard,
  // approval authorization) are mapped from their reason code.
  const policyId = decision.policyId ?? policyIdForReason(decision.reasonCode);
  const policyVersion = decision.policyVersion ?? (policyId === undefined ? undefined : '1');
  return createEventEnvelope({
    type: AI_SECURITY_BLOCKED_EVENT,
    version: 1,
    tenantId: decision.organizationId,
    ...(decision.workspaceId === undefined ? {} : { workspaceId: decision.workspaceId }),
    correlationId: decision.invocationId,
    actor: { kind: 'user', id: decision.actorId },
    payload: {
      actorId: decision.actorId,
      agent: decision.origin,
      invocationId: decision.invocationId,
      ...(decision.agentId === undefined ? {} : { agentId: decision.agentId }),
      ...(decision.delegationId === undefined ? {} : { delegationId: decision.delegationId }),
      organizationId: decision.organizationId,
      ...(decision.workspaceId === undefined ? {} : { workspaceId: decision.workspaceId }),
      ...(decision.toolId === undefined ? {} : { toolId: decision.toolId }),
      ...(decision.capabilityId === undefined ? {} : { capabilityId: decision.capabilityId }),
      action: decision.action,
      ...(policyId === undefined ? {} : { policyId }),
      ...(policyVersion === undefined ? {} : { policyVersion }),
      ...(decision.policyRules === undefined ? {} : { policyRules: [...decision.policyRules] }),
      policyDecision: decision.policyDecision,
      reasonCode: decision.reasonCode,
      reason: decision.reason,
      outcome: decision.outcome,
    },
    metadata: {
      version: 1,
      category: 'platform',
      priority: 'high',
      deliverySemantics: 'at_least_once',
    },
  });
}
