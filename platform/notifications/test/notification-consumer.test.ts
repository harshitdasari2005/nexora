/**
 * Consumer tests: the NotificationEventConsumer projects business events
 * into recipient-scoped notifications and workspace activity. These prove
 * idempotency (duplicate delivery → exactly one notification), preference
 * gating, stream publication, and that the consumer never throws into the
 * publisher.
 */

import { describe, expect, it } from 'vitest';

import { createEventEnvelope } from '@nexora/shared/events';

import { NotificationPreferences } from '../src/domain/notification-preferences.js';
import { NotificationEventConsumer } from '../src/consumer/notification-consumer.js';
import { NotificationPolicy } from '../src/policy/notification-policy.js';
import { NotificationStream } from '../src/stream/notification-stream.js';
import type { NotificationPreferencesRepository } from '../src/repositories/notification-repository.js';
import {
  MemoryActivityRepository,
  MemoryNotificationRepository,
  MemoryPreferencesRepository,
  RecordingPublisher,
} from './helpers.js';

const TENANT = 'org_tenant_a';
const WORKSPACE = 'ws_a';
const ACTOR = 'user_sarah';

function projectCreatedEvent(): ReturnType<typeof createEventEnvelope> {
  return createEventEnvelope({
    type: 'project.created',
    tenantId: TENANT,
    workspaceId: WORKSPACE,
    correlationId: 'corr_1',
    actor: { kind: 'user', id: ACTOR },
    payload: { name: 'Mobile Banking' },
  });
}

describe('NotificationEventConsumer', () => {
  it('projects one event into a notification, activity item, and stream event', async () => {
    const notifications = new MemoryNotificationRepository();
    const preferences = new MemoryPreferencesRepository();
    const activity = new MemoryActivityRepository();
    const publisher = new RecordingPublisher();
    const stream = new NotificationStream();
    const received: Array<{ kind: string }> = [];
    stream.subscribe((event) => received.push(event));

    const consumer = new NotificationEventConsumer({
      policy: new NotificationPolicy(),
      notifications,
      preferences,
      activity,
      publisher,
      stream,
    });

    await consumer.handle(projectCreatedEvent());

    expect(notifications.notifications.size).toBe(1);
    const notification = [...notifications.notifications.values()][0];
    if (notification === undefined) {
      throw new Error('expected notification');
    }
    expect(notification.recipientId).toBe(ACTOR);
    expect(notification.tenantId).toBe(TENANT);
    expect(notification.type).toBe('project.created');

    expect(activity.items.size).toBe(1);
    const item = [...activity.items.values()][0];
    expect(item?.workspaceId).toBe(WORKSPACE);

    // Stream received exactly one notification + one activity event.
    expect(received.filter((e) => e.kind === 'notification')).toHaveLength(1);
    expect(received.filter((e) => e.kind === 'activity')).toHaveLength(1);

    // Observability: notification.created published once.
    expect(publisher.published.filter((e) => e.type === 'notification.created')).toHaveLength(1);
  });

  it('is idempotent: duplicate delivery creates exactly one notification', async () => {
    const notifications = new MemoryNotificationRepository();
    const preferences = new MemoryPreferencesRepository();
    const activity = new MemoryActivityRepository();
    const publisher = new RecordingPublisher();
    const stream = new NotificationStream();

    const consumer = new NotificationEventConsumer({
      policy: new NotificationPolicy(),
      notifications,
      preferences,
      activity,
      publisher,
      stream,
    });

    const event = projectCreatedEvent();
    await consumer.handle(event);
    await consumer.handle(event);
    await consumer.handle(event);

    expect(notifications.notifications.size).toBe(1);
    expect(activity.items.size).toBe(1);
    expect(publisher.published.filter((e) => e.type === 'notification.created')).toHaveLength(1);
  });

  it('respects preferences: a disabled category produces no notification (but activity still records)', async () => {
    const notifications = new MemoryNotificationRepository();
    const preferences = new MemoryPreferencesRepository();
    const activity = new MemoryActivityRepository();
    const publisher = new RecordingPublisher();
    const stream = new NotificationStream();

    const userPreferences = NotificationPreferences.create(
      { userId: ACTOR, tenantId: TENANT },
      '2026-08-10T10:00:00.000Z',
    );
    userPreferences.setCategory('project', false, '2026-08-10T10:00:00.000Z');
    await preferences.save(userPreferences);

    const consumer = new NotificationEventConsumer({
      policy: new NotificationPolicy(),
      notifications,
      preferences,
      activity,
      publisher,
      stream,
    });

    await consumer.handle(projectCreatedEvent());

    // No recipient notification, no stream event for it.
    expect(notifications.notifications.size).toBe(0);
    // The business action is unaffected — activity still records the event.
    expect(activity.items.size).toBe(1);
  });

  it('never throws into the publisher: a failing preference lookup is swallowed and logged', async () => {
    const notifications = new MemoryNotificationRepository();
    const preferences: NotificationPreferencesRepository = {
      async findByUser() {
        throw new Error('database down');
      },
      async save() {},
    };
    const activity = new MemoryActivityRepository();
    const publisher = new RecordingPublisher();
    const stream = new NotificationStream();
    const logged: string[] = [];

    const consumer = new NotificationEventConsumer({
      policy: new NotificationPolicy(),
      notifications,
      preferences,
      activity,
      publisher,
      stream,
      logger: { error: () => logged.push('error') },
    });

    // Must resolve, not reject.
    await expect(consumer.handle(projectCreatedEvent())).resolves.toBeUndefined();
    expect(logged.length).toBeGreaterThan(0);
  });

  it('ignores out-of-catalog events entirely', async () => {
    const notifications = new MemoryNotificationRepository();
    const preferences = new MemoryPreferencesRepository();
    const activity = new MemoryActivityRepository();
    const publisher = new RecordingPublisher();
    const stream = new NotificationStream();

    const consumer = new NotificationEventConsumer({
      policy: new NotificationPolicy(),
      notifications,
      preferences,
      activity,
      publisher,
      stream,
    });

    await consumer.handle(
      createEventEnvelope({
        type: 'crm.deal.won',
        tenantId: TENANT,
        correlationId: 'corr_2',
        actor: { kind: 'user', id: ACTOR },
        payload: {},
      }),
    );

    expect(notifications.notifications.size).toBe(0);
    expect(activity.items.size).toBe(0);
    expect(publisher.published).toHaveLength(0);
  });

  it('does not project a notification for system/agent actors (no human recipient)', async () => {
    const notifications = new MemoryNotificationRepository();
    const preferences = new MemoryPreferencesRepository();
    const activity = new MemoryActivityRepository();
    const publisher = new RecordingPublisher();
    const stream = new NotificationStream();

    const consumer = new NotificationEventConsumer({
      policy: new NotificationPolicy(),
      notifications,
      preferences,
      activity,
      publisher,
      stream,
    });

    await consumer.handle(
      createEventEnvelope({
        type: 'project.created',
        tenantId: TENANT,
        workspaceId: WORKSPACE,
        correlationId: 'corr_3',
        actor: { kind: 'agent', id: 'agent_1' },
        payload: { name: 'Mobile Banking' },
      }),
    );

    expect(notifications.notifications.size).toBe(0);
    // Activity still records the workspace event.
    expect(activity.items.size).toBe(1);
  });
});
