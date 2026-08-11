/**
 * @nexora/module-notifications — notification event consumer.
 *
 * The consumer sits on the canonical event stream (the EventPublisher seam):
 * for every business event it evaluates the deterministic policy and
 * projects the outcome into recipient-scoped notifications and a
 * workspace-scoped activity read model.
 *
 * Security and reliability contract:
 * - Recipients come ONLY from the trusted event actor (server-derived).
 * - Idempotency: one notification per (source event, recipient, tenant) —
 *   a duplicate delivery never creates a duplicate notification.
 * - Preferences gate presentation/delivery, never the business action.
 * - The consumer NEVER throws into the publisher: a notification failure is
 *   logged and swallowed so the business mutation that emitted the event is
 *   never broken by the projection.
 */

import type { EventEnvelope, EventPublisher } from '@nexora/shared/events';
import type { TenantId, UserId, WorkspaceId } from '@nexora/contracts/common';
import { nowIso } from '@nexora/shared/time';

import { ActivityItem } from '../domain/activity-item.js';
import { Notification } from '../domain/notification.js';
import { notificationCreatedEvent, type NotificationEventContext } from '../events/index.js';
import type { NotificationPolicy } from '../policy/notification-policy.js';
import type {
  ActivityRepository,
  NotificationPreferencesRepository,
  NotificationRepository,
} from '../repositories/notification-repository.js';
import type { NotificationStream } from '../stream/notification-stream.js';

/** A minimal structured logger surface (satisfied by Fastify's logger). */
export interface NotificationConsumerLogger {
  error(obj: Record<string, unknown>, message?: string): void;
}

/** Dependencies of the {@link NotificationEventConsumer}. */
export interface NotificationEventConsumerDependencies {
  /** The deterministic policy (event → notifications/activity). */
  policy: NotificationPolicy;
  /** The notification aggregate persistence port. */
  notifications: NotificationRepository;
  /** The preferences persistence port. */
  preferences: NotificationPreferencesRepository;
  /** The activity read-model persistence port. */
  activity: ActivityRepository;
  /** Publishes notification.created/read events (observability). */
  publisher: EventPublisher;
  /** The in-process stream (real-time SSE transport seam). */
  stream: NotificationStream;
  /** An optional logger (failures never propagate to the publisher). */
  logger?: NotificationConsumerLogger;
}

/**
 * Consumes the canonical business event stream and projects notifications
 * and activity items. Attached to the EventPublisher seam at the composition
 * root — domains never call it directly.
 */
export class NotificationEventConsumer {
  readonly #policy: NotificationPolicy;
  readonly #notifications: NotificationRepository;
  readonly #preferences: NotificationPreferencesRepository;
  readonly #activity: ActivityRepository;
  readonly #publisher: EventPublisher;
  readonly #stream: NotificationStream;
  readonly #logger?: NotificationConsumerLogger;

  constructor(dependencies: NotificationEventConsumerDependencies) {
    this.#policy = dependencies.policy;
    this.#notifications = dependencies.notifications;
    this.#preferences = dependencies.preferences;
    this.#activity = dependencies.activity;
    this.#publisher = dependencies.publisher;
    this.#stream = dependencies.stream;
    this.#logger = dependencies.logger;
  }

  /**
   * Projects one event envelope. Never throws: every failure is logged so
   * the event publisher (and therefore the business mutation) is unaffected.
   */
  async handle(event: EventEnvelope): Promise<void> {
    try {
      const outcome = this.#policy.evaluate(event);
      const now = nowIso();

      // Idempotency guard shared across the projections of one event.
      const seenNotifications = new Set<string>();
      const seenActivity = new Set<string>();

      for (const spec of outcome.notifications) {
        const key = `${spec.recipientId}:${event.id}`;
        if (seenNotifications.has(key)) {
          continue;
        }
        seenNotifications.add(key);
        await this.#projectNotification(event, spec, now);
      }

      for (const spec of outcome.activity) {
        if (seenActivity.has(event.id)) {
          continue;
        }
        seenActivity.add(event.id);
        await this.#projectActivity(event, spec, now);
      }
    } catch (caught) {
      this.#logger?.error(
        { err: caught, eventId: event.id, eventType: event.type },
        'notification consumer failed',
      );
    }
  }

  /** Projects one recipient-scoped notification (idempotent). */
  async #projectNotification(
    event: EventEnvelope,
    spec: ReturnType<NotificationPolicy['evaluate']>['notifications'][number],
    now: string,
  ): Promise<void> {
    const tenantId = event.tenantId as TenantId;
    const recipientId = spec.recipientId;

    // Idempotency: a duplicate delivery of the same event must not create a
    // second notification for the same recipient.
    const existing = await this.#notifications.findBySourceEvent(
      event.id,
      recipientId as UserId,
      tenantId,
    );
    if (existing !== undefined) {
      return;
    }

    // Preferences gate delivery/presentation, never the business action.
    const preferences = await this.#preferences.findByUser(recipientId as UserId, tenantId);
    if (preferences !== undefined && !preferences.isEnabled(spec.category)) {
      return;
    }

    const notification = Notification.create(
      {
        recipientId: recipientId as UserId,
        tenantId,
        workspaceId: spec.workspaceId as WorkspaceId | undefined,
        type: spec.type,
        category: spec.category,
        title: spec.title,
        body: spec.body,
        priority: spec.priority,
        action: spec.action,
        sourceEventId: event.id,
        correlationId: event.correlationId,
      },
      now,
    );
    await this.#notifications.save(notification);

    // Observability: notification.created rides the same canonical envelope.
    const context: NotificationEventContext = {
      actor: { kind: 'system', id: 'notification-platform' },
      correlationId: event.correlationId,
      tenantId,
    };
    await this.#publisher.publish([
      notificationCreatedEvent(context, {
        notificationId: notification.id,
        recipientId: notification.recipientId,
        tenantId,
        workspaceId: notification.workspaceId,
        type: notification.type,
      }),
    ]);

    // Real-time push to subscribed SSE connections.
    this.#stream.publish({ kind: 'notification', notification });
  }

  /** Projects one workspace-scoped activity item (idempotent). */
  async #projectActivity(
    event: EventEnvelope,
    spec: ReturnType<NotificationPolicy['evaluate']>['activity'][number],
    now: string,
  ): Promise<void> {
    const tenantId = event.tenantId as TenantId;

    const existing = await this.#activity.findBySourceEvent(event.id, tenantId);
    if (existing !== undefined) {
      return;
    }

    const item = ActivityItem.create(
      {
        tenantId,
        workspaceId: spec.workspaceId as WorkspaceId | undefined,
        type: spec.type,
        title: spec.title,
        body: spec.body,
        actorId: spec.actorId,
        sourceEventId: event.id,
        correlationId: event.correlationId,
      },
      now,
    );
    await this.#activity.save(item);

    this.#stream.publish({ kind: 'activity', item });
  }
}
