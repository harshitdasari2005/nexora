/**
 * @nexora/app-api — policy administration audit events (Prompt 8).
 *
 * Canonical event envelopes for policy administration, projected by the
 * NotificationPolicy into the workspace activity feed the Audit Center
 * already reads (no new table). Payloads carry ids, versions, the change
 * type, the config HASH and the actor — NEVER configuration values.
 */

import { createEventEnvelope, type EventEnvelope } from '@nexora/shared/events';

export const POLICY_VERSION_CREATED_EVENT = 'policy.version_created';
export const POLICY_ENABLED_EVENT = 'policy.enabled';
export const POLICY_DISABLED_EVENT = 'policy.disabled';
export const POLICY_ADMIN_DENIED_EVENT = 'policy.admin_denied';

const METADATA = {
  version: 1,
  category: 'platform',
  priority: 'high',
  deliverySemantics: 'at_least_once',
} as const;

/** The facts of a stored policy version (no configuration values). */
export interface PolicyVersionEventInput {
  organizationId: string;
  workspaceId: string;
  actorId: string;
  policyId: string;
  version: number;
  previousVersion?: number;
  changeType: 'created' | 'version' | 'enabled' | 'disabled';
  configHash: string;
  enabled: boolean;
  correlationId: string;
}

/** The event of a newly stored policy version (type derived from the change type). */
export function policyVersionEvent(input: PolicyVersionEventInput): EventEnvelope {
  const type =
    input.changeType === 'enabled'
      ? POLICY_ENABLED_EVENT
      : input.changeType === 'disabled'
        ? POLICY_DISABLED_EVENT
        : POLICY_VERSION_CREATED_EVENT;
  return createEventEnvelope({
    type,
    version: 1,
    tenantId: input.organizationId,
    workspaceId: input.workspaceId,
    correlationId: input.correlationId,
    actor: { kind: 'user', id: input.actorId },
    payload: {
      organizationId: input.organizationId,
      workspaceId: input.workspaceId,
      actorId: input.actorId,
      policyId: input.policyId,
      version: input.version,
      ...(input.previousVersion === undefined ? {} : { previousVersion: input.previousVersion }),
      changeType: input.changeType,
      configHash: input.configHash,
      enabled: input.enabled,
    },
    metadata: METADATA,
  });
}

/** The facts of an unauthorized policy administration attempt. */
export interface PolicyAdminDeniedEventInput {
  organizationId: string;
  workspaceId: string;
  actorId: string;
  action: 'read' | 'manage';
  requiredCapability: 'policy.read' | 'policy.manage';
  policyId?: string;
  correlationId: string;
}

/** The event of a refused (403) policy administration read/mutation. */
export function policyAdminDeniedEvent(input: PolicyAdminDeniedEventInput): EventEnvelope {
  return createEventEnvelope({
    type: POLICY_ADMIN_DENIED_EVENT,
    version: 1,
    tenantId: input.organizationId,
    workspaceId: input.workspaceId,
    correlationId: input.correlationId,
    actor: { kind: 'user', id: input.actorId },
    payload: {
      organizationId: input.organizationId,
      workspaceId: input.workspaceId,
      actorId: input.actorId,
      action: input.action,
      requiredCapability: input.requiredCapability,
      ...(input.policyId === undefined ? {} : { policyId: input.policyId }),
      reasonCode: 'FORBIDDEN',
    },
    metadata: METADATA,
  });
}
