/**
 * @nexora/module-notifications — repository ports.
 *
 * The persistence seam of the Notification platform. Every read is
 * recipient/tenant scoped — a notification id alone grants nothing, and the
 * caller (application layer) always supplies the TRUSTED recipient id.
 */

import type { TenantId, UserId, WorkspaceId } from '@nexora/contracts/common';

import type { ActivityItem } from '../domain/activity-item.js';
import type { Notification } from '../domain/notification.js';
import type { NotificationPreferences } from '../domain/notification-preferences.js';

/** The Notifications aggregate persistence port. */
export interface NotificationRepository {
  /** Persists (inserts or replaces) a notification aggregate. */
  save(notification: Notification): Promise<void>;

  /**
   * Finds a notification by id within its recipient scope (returns
   * `undefined` for a foreign or non-existent id).
   */
  findByIdAndRecipient(
    notificationId: string,
    recipientId: UserId,
    tenantId: TenantId,
  ): Promise<Notification | undefined>;

  /**
   * Finds a notification by its source event (the idempotency check).
   * Returns `undefined` when no notification was created from the event.
   */
  findBySourceEvent(
    sourceEventId: string,
    recipientId: UserId,
    tenantId: TenantId,
  ): Promise<Notification | undefined>;

  /**
   * Lists a recipient's notifications, newest first. The recipient scope is
   * REQUIRED — this port never returns another user's notifications. An
   * optional workspace filters to a workspace.
   */
  listByRecipient(
    recipientId: UserId,
    tenantId: TenantId,
    options?: { workspaceId?: WorkspaceId; limit?: number },
  ): Promise<readonly Notification[]>;

  /** Counts the recipient's unread notifications (bounded, never loads all). */
  countUnread(
    recipientId: UserId,
    tenantId: TenantId,
    options?: { workspaceId?: WorkspaceId },
  ): Promise<number>;

  /** Marks one notification read (recipient-scoped). Returns true when changed. */
  markRead(
    notificationId: string,
    recipientId: UserId,
    tenantId: TenantId,
    now: string,
  ): Promise<boolean>;

  /** Marks all of a recipient's notifications read (optional workspace). */
  markAllRead(
    recipientId: UserId,
    tenantId: TenantId,
    options?: { workspaceId?: WorkspaceId },
  ): Promise<number>;
}

/** The NotificationPreferences aggregate persistence port. */
export interface NotificationPreferencesRepository {
  /** Loads a user's preferences, or `undefined` (defaults apply). */
  findByUser(userId: UserId, tenantId: TenantId): Promise<NotificationPreferences | undefined>;

  /** Persists (inserts or replaces) preferences. */
  save(preferences: NotificationPreferences): Promise<void>;
}

/** The ActivityItem read-model persistence port. */
export interface ActivityRepository {
  /** Persists an activity item. */
  save(item: ActivityItem): Promise<void>;

  /** The idempotency check for activity projection. */
  findBySourceEvent(sourceEventId: string, tenantId: TenantId): Promise<ActivityItem | undefined>;

  /**
   * Lists the activity of a workspace (or of the tenant when no workspace is
   * given), newest first. Workspace scope is REQUIRED for workspace views —
   * this port never returns another workspace's activity.
   */
  listByWorkspace(
    tenantId: TenantId,
    options?: { workspaceId?: WorkspaceId; limit?: number },
  ): Promise<readonly ActivityItem[]>;
}
