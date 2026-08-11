/**
 * Test doubles for the Notification platform: in-memory implementations of
 * the notification, preferences, and activity repository ports so the
 * consumer and application service are tested in isolation (no PostgreSQL).
 */

import type { EventEnvelope, EventPublisher } from '@nexora/shared/events';

import type { ActivityItem } from '../src/domain/activity-item.js';
import type { Notification } from '../src/domain/notification.js';
import type { NotificationPreferences } from '../src/domain/notification-preferences.js';
import type {
  ActivityRepository,
  NotificationPreferencesRepository,
  NotificationRepository,
} from '../src/repositories/notification-repository.js';

/** An in-memory {@link NotificationRepository}. */
export class MemoryNotificationRepository implements NotificationRepository {
  readonly notifications = new Map<string, Notification>();

  async save(notification: Notification): Promise<void> {
    this.notifications.set(notification.id, notification);
  }

  async findByIdAndRecipient(
    notificationId: string,
    recipientId: string,
    tenantId: string,
  ): Promise<Notification | undefined> {
    const found = this.notifications.get(notificationId);
    return found?.recipientId === recipientId && found?.tenantId === tenantId ? found : undefined;
  }

  async findBySourceEvent(
    sourceEventId: string,
    recipientId: string,
    tenantId: string,
  ): Promise<Notification | undefined> {
    for (const notification of this.notifications.values()) {
      if (
        notification.sourceEventId === sourceEventId &&
        notification.recipientId === recipientId &&
        notification.tenantId === tenantId
      ) {
        return notification;
      }
    }
    return undefined;
  }

  async listByRecipient(
    recipientId: string,
    tenantId: string,
    options?: { workspaceId?: string; limit?: number },
  ): Promise<readonly Notification[]> {
    return [...this.notifications.values()]
      .filter((notification) => {
        const scoped =
          notification.recipientId === recipientId && notification.tenantId === tenantId;
        if (options?.workspaceId !== undefined) {
          return scoped && notification.workspaceId === options.workspaceId;
        }
        return scoped;
      })
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, options?.limit ?? 100);
  }

  async countUnread(
    recipientId: string,
    tenantId: string,
    options?: { workspaceId?: string },
  ): Promise<number> {
    const list = await this.listByRecipient(recipientId, tenantId, options);
    return list.filter((notification) => notification.status === 'unread').length;
  }

  async markRead(
    notificationId: string,
    recipientId: string,
    tenantId: string,
    now: string,
  ): Promise<boolean> {
    const existing = await this.findByIdAndRecipient(notificationId, recipientId, tenantId);
    if (existing === undefined) {
      return false;
    }
    const result = existing.markRead(now);
    if (result.ok) {
      await this.save(result.notification);
      return true;
    }
    return false;
  }

  async markAllRead(
    recipientId: string,
    tenantId: string,
    options?: { workspaceId?: string },
  ): Promise<number> {
    const list = await this.listByRecipient(recipientId, tenantId, options);
    let marked = 0;
    for (const notification of list) {
      if (notification.status !== 'unread') {
        continue;
      }
      const result = notification.markRead(new Date().toISOString());
      if (result.ok) {
        await this.save(result.notification);
        marked += 1;
      }
    }
    return marked;
  }
}

/** An in-memory {@link NotificationPreferencesRepository}. */
export class MemoryPreferencesRepository implements NotificationPreferencesRepository {
  readonly preferences = new Map<string, NotificationPreferences>();

  async findByUser(userId: string, tenantId: string): Promise<NotificationPreferences | undefined> {
    for (const preferences of this.preferences.values()) {
      if (preferences.userId === userId && preferences.tenantId === tenantId) {
        return preferences;
      }
    }
    return undefined;
  }

  async save(preferences: NotificationPreferences): Promise<void> {
    this.preferences.set(preferences.id, preferences);
  }
}

/** An in-memory {@link ActivityRepository}. */
export class MemoryActivityRepository implements ActivityRepository {
  readonly items = new Map<string, ActivityItem>();

  async save(item: ActivityItem): Promise<void> {
    this.items.set(item.id, item);
  }

  async findBySourceEvent(
    sourceEventId: string,
    tenantId: string,
  ): Promise<ActivityItem | undefined> {
    for (const item of this.items.values()) {
      if (item.sourceEventId === sourceEventId && item.tenantId === tenantId) {
        return item;
      }
    }
    return undefined;
  }

  async listByWorkspace(
    tenantId: string,
    options?: { workspaceId?: string; limit?: number },
  ): Promise<readonly ActivityItem[]> {
    return [...this.items.values()]
      .filter((item) => {
        const scoped = item.tenantId === tenantId;
        if (options?.workspaceId !== undefined) {
          return scoped && item.workspaceId === options.workspaceId;
        }
        return scoped;
      })
      .sort((a, b) => b.occurredAt.localeCompare(a.occurredAt))
      .slice(0, options?.limit ?? 100);
  }
}

/** A recording {@link EventPublisher} (test double). */
export class RecordingPublisher implements EventPublisher {
  readonly published: EventEnvelope[] = [];

  async publish(events: readonly EventEnvelope[]): Promise<void> {
    this.published.push(...events);
  }
}
