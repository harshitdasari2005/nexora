/**
 * @nexora/module-integrations — integration event catalog.
 *
 * The integration surface emits its own domain events (endpoint lifecycle,
 * delivery results, inbound email actions) so every integration action is
 * traceable through the same canonical envelope (BKD §9.3: connectors are
 * adapters — the audit trail is events, not connector code).
 */

import type { EventEnvelope } from '@nexora/shared/events';
import { createEventEnvelope } from '@nexora/shared/events';
import type { TenantId, WorkspaceId } from '@nexora/contracts/common';

/** The canonical event types emitted by the integration surface. */
export const INTEGRATION_EVENT_TYPES = {
  /** A webhook endpoint was created (audit). */
  webhookCreated: 'integration.webhook.created',
  /** A webhook endpoint was updated (audit). */
  webhookUpdated: 'integration.webhook.updated',
  /** A webhook endpoint was deleted (audit). */
  webhookDeleted: 'integration.webhook.deleted',
  /** A signed payload was delivered to a webhook endpoint. */
  webhookDelivered: 'integration.webhook.delivered',
  /** A webhook delivery failed (retries exhausted). */
  webhookFailed: 'integration.webhook.failed',
  /** An email notification was dispatched. */
  emailDispatched: 'integration.email.dispatched',
  /** An inbound email action was accepted and routed (audit). */
  inboundEmailAction: 'integration.email.inbound',
} as const;

export type IntegrationEventType =
  (typeof INTEGRATION_EVENT_TYPES)[keyof typeof INTEGRATION_EVENT_TYPES];

/** The event context for integration events (workspace-scoped). */
export interface IntegrationEventContext {
  actor: { kind: 'user' | 'system' | 'agent'; id: string };
  correlationId: string;
  organizationId: TenantId;
}

/** Payload of {@link integration.webhook.created|updated|deleted}. */
export interface WebhookEndpointEventPayload {
  /** The endpoint id. */
  endpointId: string;
  /** The workspace scope. */
  workspaceId: WorkspaceId;
  /** The subscribed event types (as the caller configured them). */
  eventTypes: readonly string[];
  /** Whether the endpoint is currently enabled. */
  enabled: boolean;
}

/** Payload of {@link integration.webhook.delivered|failed}. */
export interface WebhookDeliveryEventPayload {
  /** The endpoint id. */
  endpointId: string;
  /** The workspace scope. */
  workspaceId: WorkspaceId;
  /** The business event that triggered the delivery. */
  eventId: string;
  /** The delivery attempt that produced this outcome. */
  attempt: number;
  /** The HTTP status received (delivered only). */
  statusCode?: number;
  /** A human-readable failure reason (failed only). */
  error?: string;
}

/** Payload of {@link integration.email.dispatched}. */
export interface EmailDispatchedEventPayload {
  /** The email outbox id. */
  emailId: string;
  /** The recipient user id. */
  recipientId: string;
  /** The subject line. */
  subject: string;
  /** The workspace scope, when the notification was workspace-scoped. */
  workspaceId?: WorkspaceId;
}

/** Payload of {@link integration.email.inbound}. */
export interface InboundEmailEventPayload {
  /** The inbound action type (`approval.decide`). */
  action: string;
  /** The external message id (dedupe key). */
  messageId: string;
  /** The sender email address (verified against the tenant allowlist). */
  from: string;
  /** The target entity referenced by the action (e.g. the approval id). */
  targetId: string;
  /** The workspace scope. */
  workspaceId: WorkspaceId;
}

/** The event category for integration events (Generic platform domain). */
export const INTEGRATIONS_EVENT_CATEGORY = 'platform' as const;

/** Creates a workspace-scoped integration event envelope. */
function integrationEvent<T>(
  type: IntegrationEventType,
  context: IntegrationEventContext,
  workspaceId: WorkspaceId | undefined,
  payload: T,
  version = 1,
): EventEnvelope<T> {
  return createEventEnvelope({
    type,
    version,
    tenantId: context.organizationId,
    workspaceId,
    correlationId: context.correlationId,
    actor: context.actor,
    payload,
    metadata: {
      version,
      category: INTEGRATIONS_EVENT_CATEGORY,
      priority: 'normal',
      deliverySemantics: 'at_least_once',
    },
  });
}

/** A webhook endpoint was created. */
export function webhookCreatedEvent(
  context: IntegrationEventContext,
  payload: WebhookEndpointEventPayload,
): EventEnvelope<WebhookEndpointEventPayload> {
  return integrationEvent(
    INTEGRATION_EVENT_TYPES.webhookCreated,
    context,
    payload.workspaceId,
    payload,
  );
}

/** A webhook endpoint was updated. */
export function webhookUpdatedEvent(
  context: IntegrationEventContext,
  payload: WebhookEndpointEventPayload,
): EventEnvelope<WebhookEndpointEventPayload> {
  return integrationEvent(
    INTEGRATION_EVENT_TYPES.webhookUpdated,
    context,
    payload.workspaceId,
    payload,
  );
}

/** A webhook endpoint was deleted. */
export function webhookDeletedEvent(
  context: IntegrationEventContext,
  payload: WebhookEndpointEventPayload,
): EventEnvelope<WebhookEndpointEventPayload> {
  return integrationEvent(
    INTEGRATION_EVENT_TYPES.webhookDeleted,
    context,
    payload.workspaceId,
    payload,
  );
}

/** A signed payload was delivered to a webhook endpoint. */
export function webhookDeliveredEvent(
  context: IntegrationEventContext,
  payload: WebhookDeliveryEventPayload,
): EventEnvelope<WebhookDeliveryEventPayload> {
  return integrationEvent(
    INTEGRATION_EVENT_TYPES.webhookDelivered,
    context,
    payload.workspaceId,
    payload,
  );
}

/** A webhook delivery failed (retries exhausted). */
export function webhookFailedEvent(
  context: IntegrationEventContext,
  payload: WebhookDeliveryEventPayload,
): EventEnvelope<WebhookDeliveryEventPayload> {
  return integrationEvent(
    INTEGRATION_EVENT_TYPES.webhookFailed,
    context,
    payload.workspaceId,
    payload,
  );
}

/** An email notification was dispatched. */
export function emailDispatchedEvent(
  context: IntegrationEventContext,
  payload: EmailDispatchedEventPayload,
): EventEnvelope<EmailDispatchedEventPayload> {
  return integrationEvent(
    INTEGRATION_EVENT_TYPES.emailDispatched,
    context,
    payload.workspaceId,
    payload,
  );
}

/** An inbound email action was accepted and routed. */
export function inboundEmailActionEvent(
  context: IntegrationEventContext,
  payload: InboundEmailEventPayload,
): EventEnvelope<InboundEmailEventPayload> {
  return integrationEvent(
    INTEGRATION_EVENT_TYPES.inboundEmailAction,
    context,
    payload.workspaceId,
    payload,
  );
}
