/**
 * @nexora/module-notifications — notification events.
 *
 * The Notification platform event vocabulary (category `notification`).
 * These events ride the canonical `@nexora/shared/events` envelope and are
 * emitted by the notification consumer for observability (notification
 * created / read). They are NEVER re-consumed by the notification policy
 * (the policy maps business events only), so no recursion is possible.
 */

import { createEventEnvelope, type EventActor, type EventEnvelope } from '@nexora/shared/events';
import type { TenantId } from '@nexora/contracts/common';

/** Category applied to every notification platform event. */
export const NOTIFICATION_EVENT_CATEGORY = 'notification' as const;

/** Stable notification event type names. */
export const NOTIFICATION_EVENT_TYPES = {
  notificationCreated: 'notification.created',
  notificationRead: 'notification.read',
} as const;

/** Payload of the {@link notificationCreatedEvent}. */
export interface NotificationCreatedPayload {
  /** The created notification id. */
  notificationId: string;
  /** The recipient user. */
  recipientId: string;
  /** The tenant (organization) scope. */
  tenantId: TenantId;
  /** The workspace scope, when workspace-scoped. */
  workspaceId?: string;
  /** The source business event type. */
  type: string;
}

/** Payload of the {@link notificationReadEvent}. */
export interface NotificationReadPayload {
  /** The read notification id. */
  notificationId: string;
  /** The recipient user. */
  recipientId: string;
  /** The tenant (organization) scope. */
  tenantId: TenantId;
}

/** Context required to emit a notification event. */
export interface NotificationEventContext {
  /** The actor that caused the event (the platform/system). */
  actor: EventActor;
  /** Correlation id of the originating execution. */
  correlationId: string;
  /** Tenant (organization) scope. */
  tenantId: TenantId;
}

/** Creates a typed notification event envelope with canonical metadata. */
function notificationEvent<P>(
  type: string,
  context: NotificationEventContext,
  payload: P,
  version = 1,
): EventEnvelope<P> {
  return createEventEnvelope({
    type,
    version,
    actor: context.actor,
    correlationId: context.correlationId,
    tenantId: context.tenantId,
    payload,
    metadata: {
      version,
      category: NOTIFICATION_EVENT_CATEGORY,
      priority: 'normal',
      deliverySemantics: 'at_least_once',
    },
  });
}

/** A notification was created (notification.created). */
export function notificationCreatedEvent(
  context: NotificationEventContext,
  payload: NotificationCreatedPayload,
): EventEnvelope<NotificationCreatedPayload> {
  return notificationEvent(NOTIFICATION_EVENT_TYPES.notificationCreated, context, payload);
}

/** A notification was marked read (notification.read). */
export function notificationReadEvent(
  context: NotificationEventContext,
  payload: NotificationReadPayload,
): EventEnvelope<NotificationReadPayload> {
  return notificationEvent(NOTIFICATION_EVENT_TYPES.notificationRead, context, payload);
}
