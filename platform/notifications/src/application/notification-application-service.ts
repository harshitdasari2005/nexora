/**
 * @nexora/module-notifications — NotificationApplicationService.
 *
 * The application layer of the Notification platform: the read/query surface
 * for the notification inbox, preferences, and the activity feed. Every
 * query is scoped by the TRUSTED authenticated context (recipient = the
 * authenticated user, tenant = the authenticated organization) — a
 * client-supplied userId/tenantId/workspaceId can never widen the scope.
 *
 * The service contains no business rules of its own: the policy decides who
 * gets notified, the aggregates enforce their invariants, and the consumer
 * projects events. This service only reads (and applies user-initiated
 * preference changes / read transitions).
 */

import type { NotificationPriority } from '@nexora/contracts/notification';
import type { TenantId, UserId, WorkspaceId } from '@nexora/contracts/common';
import type { Result } from '@nexora/shared/result';
import { ok } from '@nexora/shared/result';
import { nowIso } from '@nexora/shared/time';

import { ActivityItem } from '../domain/activity-item.js';
import {
  NOTIFICATION_CATEGORIES,
  Notification,
  type NotificationAction,
  type NotificationCategory,
} from '../domain/notification.js';
import { NotificationPreferences } from '../domain/notification-preferences.js';
import type {
  ActivityRepository,
  NotificationPreferencesRepository,
  NotificationRepository,
} from '../repositories/notification-repository.js';

/** The notification DTO exposed to clients. */
export interface NotificationDto {
  /** The notification id. */
  id: string;
  /** The source event type, e.g. `workflow.completed`. */
  type: string;
  /** The notification category. */
  category: NotificationCategory;
  /** The human-readable title. */
  title: string;
  /** The human-readable body. */
  body: string;
  /** The notification priority. */
  priority: NotificationPriority;
  /** The current read state. */
  status: 'unread' | 'read';
  /** The optional actionable link. */
  action?: NotificationAction;
  /** ISO-8601 UTC creation time. */
  createdAt: string;
  /** ISO-8601 UTC read time, when read. */
  readAt?: string;
}

/** The activity item DTO exposed to clients. */
export interface ActivityItemDto {
  /** The activity item id. */
  id: string;
  /** The source event type. */
  type: string;
  /** The user-facing activity title. */
  title: string;
  /** The user-facing activity body. */
  body: string;
  /** The acting user, when a user caused the event. */
  actorId?: string;
  /** ISO-8601 UTC time the activity occurred. */
  occurredAt: string;
}

/** The preferences DTO exposed to clients. */
export interface NotificationPreferencesDto {
  /** Category → enabled map. */
  categories: Record<string, boolean>;
  /** ISO-8601 UTC last update time. */
  updatedAt: string;
}

/** Converts a {@link Notification} aggregate to a DTO. */
export function toNotificationDto(notification: Notification): NotificationDto {
  const snapshot = Notification.snapshot(notification);
  return {
    id: snapshot.id,
    type: snapshot.type,
    category: snapshot.category,
    title: snapshot.title,
    body: snapshot.body,
    priority: snapshot.priority,
    status: snapshot.status,
    action: snapshot.action,
    createdAt: snapshot.createdAt,
    readAt: snapshot.readAt,
  };
}

/** Converts an {@link ActivityItem} to a DTO. */
export function toActivityItemDto(item: ActivityItem): ActivityItemDto {
  const snapshot = ActivityItem.snapshot(item);
  return {
    id: snapshot.id,
    type: snapshot.type,
    title: snapshot.title,
    body: snapshot.body,
    actorId: snapshot.actorId,
    occurredAt: snapshot.occurredAt,
  };
}

/** Converts preferences to a DTO. */
export function toNotificationPreferencesDto(
  preferences: NotificationPreferences,
): NotificationPreferencesDto {
  return preferences.toContract();
}

/** Dependencies of the {@link NotificationApplicationService}. */
export interface NotificationApplicationServiceDependencies {
  /** The notification aggregate persistence port. */
  notifications: NotificationRepository;
  /** The preferences persistence port. */
  preferences: NotificationPreferencesRepository;
  /** The activity read-model persistence port. */
  activity: ActivityRepository;
}

/** A list query over the notification inbox. */
export interface ListNotificationsQuery {
  /** The authenticated recipient (trusted). */
  userId: UserId;
  /** The authenticated tenant (trusted). */
  tenantId: TenantId;
  /** An optional workspace filter (verified by the caller). */
  workspaceId?: WorkspaceId;
  /** Maximum number of notifications. */
  limit?: number;
}

/** Marks one notification read (recipient-scoped). */
export interface MarkNotificationReadCommand {
  /** The notification id. */
  notificationId: string;
  /** The authenticated recipient (trusted). */
  userId: UserId;
  /** The authenticated tenant (trusted). */
  tenantId: TenantId;
}

/** Marks all of a recipient's notifications read. */
export interface MarkAllNotificationsReadCommand {
  /** The authenticated recipient (trusted). */
  userId: UserId;
  /** The authenticated tenant (trusted). */
  tenantId: TenantId;
  /** An optional workspace filter (verified by the caller). */
  workspaceId?: WorkspaceId;
}

/** Updates a single preference category. */
export interface UpdateNotificationPreferencesCommand {
  /** The authenticated user (trusted). */
  userId: UserId;
  /** The authenticated tenant (trusted). */
  tenantId: TenantId;
  /** The category to toggle. */
  category: NotificationCategory;
  /** Whether the category is enabled. */
  enabled: boolean;
}

/** A workspace/tenant activity feed query. */
export interface ListActivityQuery {
  /** The authenticated tenant (trusted). */
  tenantId: TenantId;
  /** An optional workspace filter (verified by the caller). */
  workspaceId?: WorkspaceId;
  /** Maximum number of items. */
  limit?: number;
}

/**
 * The Notification platform application service: the trusted read/query
 * surface for the inbox, preferences, and activity feed.
 */
export class NotificationApplicationService {
  readonly #notifications: NotificationRepository;
  readonly #preferences: NotificationPreferencesRepository;
  readonly #activity: ActivityRepository;

  constructor(dependencies: NotificationApplicationServiceDependencies) {
    this.#notifications = dependencies.notifications;
    this.#preferences = dependencies.preferences;
    this.#activity = dependencies.activity;
  }

  /** Lists the authenticated user's notifications (newest first). */
  async listNotifications(
    query: ListNotificationsQuery,
  ): Promise<Result<{ notifications: readonly NotificationDto[] }>> {
    const notifications = await this.#notifications.listByRecipient(query.userId, query.tenantId, {
      workspaceId: query.workspaceId,
      limit: query.limit,
    });
    return ok({ notifications: notifications.map((n) => toNotificationDto(n)) });
  }

  /** Counts the authenticated user's unread notifications. */
  async unreadCount(
    query: Omit<ListNotificationsQuery, 'limit'>,
  ): Promise<Result<{ count: number }>> {
    const count = await this.#notifications.countUnread(query.userId, query.tenantId, {
      workspaceId: query.workspaceId,
    });
    return ok({ count });
  }

  /** Marks one of the user's notifications read (idempotent). */
  async markNotificationRead(
    command: MarkNotificationReadCommand,
  ): Promise<Result<{ notification: NotificationDto } | { alreadyRead: true }>> {
    const changed = await this.#notifications.markRead(
      command.notificationId,
      command.userId,
      command.tenantId,
      nowIso(),
    );
    if (!changed) {
      const existing = await this.#notifications.findByIdAndRecipient(
        command.notificationId,
        command.userId,
        command.tenantId,
      );
      if (existing === undefined) {
        return ok({ alreadyRead: true });
      }
      return ok({ notification: toNotificationDto(existing) });
    }
    const updated = await this.#notifications.findByIdAndRecipient(
      command.notificationId,
      command.userId,
      command.tenantId,
    );
    if (updated === undefined) {
      return ok({ alreadyRead: true });
    }
    return ok({ notification: toNotificationDto(updated) });
  }

  /** Marks all of the user's notifications read (idempotent). */
  async markAllNotificationsRead(
    command: MarkAllNotificationsReadCommand,
  ): Promise<Result<{ marked: number }>> {
    const marked = await this.#notifications.markAllRead(command.userId, command.tenantId, {
      workspaceId: command.workspaceId,
    });
    return ok({ marked });
  }

  /** Loads the authenticated user's preferences (defaults when absent). */
  async getPreferences(query: {
    userId: UserId;
    tenantId: TenantId;
  }): Promise<Result<{ preferences: NotificationPreferencesDto }>> {
    const existing = await this.#preferences.findByUser(query.userId, query.tenantId);
    if (existing !== undefined) {
      return ok({ preferences: toNotificationPreferencesDto(existing) });
    }
    return ok({ preferences: { categories: {}, updatedAt: nowIso() } });
  }

  /** Updates one preference category (safe defaults preserved). */
  async updatePreferences(
    command: UpdateNotificationPreferencesCommand,
  ): Promise<Result<{ preferences: NotificationPreferencesDto }>> {
    if (!NOTIFICATION_CATEGORIES.includes(command.category)) {
      return ok({ preferences: { categories: {}, updatedAt: nowIso() } });
    }
    const now = nowIso();
    let preferences = await this.#preferences.findByUser(command.userId, command.tenantId);
    if (preferences === undefined) {
      preferences = NotificationPreferences.create(
        { userId: command.userId, tenantId: command.tenantId },
        now,
      );
    }
    preferences.setCategory(command.category, command.enabled, now);
    await this.#preferences.save(preferences);
    return ok({ preferences: toNotificationPreferencesDto(preferences) });
  }

  /** Lists the activity feed (workspace-scoped when a workspace is given). */
  async listActivity(
    query: ListActivityQuery,
  ): Promise<Result<{ activity: readonly ActivityItemDto[] }>> {
    const items = await this.#activity.listByWorkspace(query.tenantId, {
      workspaceId: query.workspaceId,
      limit: query.limit,
    });
    return ok({ activity: items.map((item) => toActivityItemDto(item)) });
  }
}

/** Handles {@link ListNotificationsQuery}. */
export class ListNotificationsHandler {
  readonly #service: NotificationApplicationService;
  constructor(service: NotificationApplicationService) {
    this.#service = service;
  }
  handle(
    query: ListNotificationsQuery,
  ): Promise<Result<{ notifications: readonly NotificationDto[] }>> {
    return this.#service.listNotifications(query);
  }
}

/** Handles the unread-count query. */
export class UnreadNotificationsCountHandler {
  readonly #service: NotificationApplicationService;
  constructor(service: NotificationApplicationService) {
    this.#service = service;
  }
  handle(query: Omit<ListNotificationsQuery, 'limit'>): Promise<Result<{ count: number }>> {
    return this.#service.unreadCount(query);
  }
}

/** Handles {@link MarkNotificationReadCommand}. */
export class MarkNotificationReadHandler {
  readonly #service: NotificationApplicationService;
  constructor(service: NotificationApplicationService) {
    this.#service = service;
  }
  handle(
    command: MarkNotificationReadCommand,
  ): Promise<Result<{ notification: NotificationDto } | { alreadyRead: true }>> {
    return this.#service.markNotificationRead(command);
  }
}

/** Handles {@link MarkAllNotificationsReadCommand}. */
export class MarkAllNotificationsReadHandler {
  readonly #service: NotificationApplicationService;
  constructor(service: NotificationApplicationService) {
    this.#service = service;
  }
  handle(command: MarkAllNotificationsReadCommand): Promise<Result<{ marked: number }>> {
    return this.#service.markAllNotificationsRead(command);
  }
}

/** Handles the get-preferences query. */
export class GetNotificationPreferencesHandler {
  readonly #service: NotificationApplicationService;
  constructor(service: NotificationApplicationService) {
    this.#service = service;
  }
  handle(query: {
    userId: UserId;
    tenantId: TenantId;
  }): Promise<Result<{ preferences: NotificationPreferencesDto }>> {
    return this.#service.getPreferences(query);
  }
}

/** Handles {@link UpdateNotificationPreferencesCommand}. */
export class UpdateNotificationPreferencesHandler {
  readonly #service: NotificationApplicationService;
  constructor(service: NotificationApplicationService) {
    this.#service = service;
  }
  handle(
    command: UpdateNotificationPreferencesCommand,
  ): Promise<Result<{ preferences: NotificationPreferencesDto }>> {
    return this.#service.updatePreferences(command);
  }
}

/** Handles {@link ListActivityQuery}. */
export class ListActivityHandler {
  readonly #service: NotificationApplicationService;
  constructor(service: NotificationApplicationService) {
    this.#service = service;
  }
  handle(query: ListActivityQuery): Promise<Result<{ activity: readonly ActivityItemDto[] }>> {
    return this.#service.listActivity(query);
  }
}
