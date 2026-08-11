/**
 * @nexora/persistence — notification repositories.
 *
 * Drizzle implementations of the Notification platform repository ports
 * (`NotificationRepository`, `NotificationPreferencesRepository`,
 * `ActivityRepository`). Aggregates are serialized via `snapshot()` and
 * reconstructed via `hydrate()` (PERSISTENCE.md §4 aggregate ownership).
 *
 * Every read is recipient/tenant scoped in SQL FIRST (defense-in-depth):
 * a notification id alone grants nothing, and the unique
 * (tenant, source_event, recipient) constraint backs idempotent projection —
 * a duplicate event delivery can never insert a second notification.
 */

import { and, eq } from 'drizzle-orm';
import type { TenantId, UserId, WorkspaceId } from '@nexora/contracts/common';
import type {
  ActivityRepository,
  NotificationPreferencesRepository,
  NotificationRepository,
} from '@nexora/module-notifications';
import { ActivityItem, Notification, NotificationPreferences } from '@nexora/module-notifications';

import type { NexoraDatabase } from '../db.js';
import { activityItems, notificationPreferences, notifications } from '../schema/index.js';

/** Converts a persisted timestamp (Date or string) to an ISO string. */
function toIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : value;
}

/** Converts an ISO string to a Date for storage. */
function toDate(iso: string): Date {
  return new Date(iso);
}

type NotificationRow = typeof notifications.$inferSelect;
type NotificationPreferencesRow = typeof notificationPreferences.$inferSelect;
type ActivityItemRow = typeof activityItems.$inferSelect;

/** Maps a notifications row to a {@link Notification} snapshot. */
function rowToNotificationSnapshot(row: NotificationRow): ReturnType<typeof Notification.snapshot> {
  return {
    id: row.id,
    recipientId: row.recipientId as UserId,
    tenantId: row.tenantId as TenantId,
    workspaceId: row.workspaceId === null ? undefined : (row.workspaceId as WorkspaceId),
    type: row.type,
    category: row.category as ReturnType<typeof Notification.snapshot>['category'],
    title: row.title,
    body: row.body,
    priority: row.priority as ReturnType<typeof Notification.snapshot>['priority'],
    status: row.status as ReturnType<typeof Notification.snapshot>['status'],
    action:
      row.action === null
        ? undefined
        : (row.action as NonNullable<ReturnType<typeof Notification.snapshot>['action']>),
    sourceEventId: row.sourceEventId,
    correlationId: row.correlationId,
    createdAt: toIso(row.createdAt),
    readAt: row.readAt === null ? undefined : toIso(row.readAt),
    version: row.version,
  };
}

/** Maps a {@link Notification} snapshot to a notifications row. */
function notificationSnapshotToRow(
  snapshot: ReturnType<typeof Notification.snapshot>,
): NotificationRow {
  return {
    id: snapshot.id,
    recipientId: snapshot.recipientId,
    tenantId: snapshot.tenantId,
    workspaceId: snapshot.workspaceId ?? null,
    type: snapshot.type,
    category: snapshot.category,
    title: snapshot.title,
    body: snapshot.body,
    priority: snapshot.priority,
    status: snapshot.status,
    action: snapshot.action ?? null,
    sourceEventId: snapshot.sourceEventId,
    correlationId: snapshot.correlationId,
    createdAt: toDate(snapshot.createdAt),
    readAt: snapshot.readAt === undefined ? null : toDate(snapshot.readAt),
    version: snapshot.version,
  };
}

/** Maps a preferences row to a {@link NotificationPreferences} snapshot. */
function rowToPreferencesSnapshot(
  row: NotificationPreferencesRow,
): ReturnType<typeof NotificationPreferences.snapshot> {
  return {
    id: row.id,
    userId: row.userId as UserId,
    tenantId: row.tenantId as TenantId,
    categories: (row.categories as Record<string, boolean>) ?? {},
    updatedAt: toIso(row.updatedAt),
    version: row.version,
  };
}

/** Maps a {@link NotificationPreferences} snapshot to a row. */
function preferencesSnapshotToRow(
  snapshot: ReturnType<typeof NotificationPreferences.snapshot>,
): NotificationPreferencesRow {
  return {
    id: snapshot.id,
    userId: snapshot.userId,
    tenantId: snapshot.tenantId,
    categories: snapshot.categories,
    updatedAt: toDate(snapshot.updatedAt),
    version: snapshot.version,
  };
}

/** Maps an activity_items row to an {@link ActivityItem} snapshot. */
function rowToActivitySnapshot(row: ActivityItemRow): ReturnType<typeof ActivityItem.snapshot> {
  return {
    id: row.id,
    tenantId: row.tenantId as TenantId,
    workspaceId: row.workspaceId === null ? undefined : (row.workspaceId as WorkspaceId),
    type: row.type,
    title: row.title,
    body: row.body,
    actorId: row.actorId ?? undefined,
    sourceEventId: row.sourceEventId,
    correlationId: row.correlationId,
    occurredAt: toIso(row.occurredAt),
  };
}

/** Maps an {@link ActivityItem} snapshot to an activity_items row. */
function activitySnapshotToRow(
  snapshot: ReturnType<typeof ActivityItem.snapshot>,
): ActivityItemRow {
  return {
    id: snapshot.id,
    tenantId: snapshot.tenantId,
    workspaceId: snapshot.workspaceId ?? null,
    type: snapshot.type,
    title: snapshot.title,
    body: snapshot.body,
    actorId: snapshot.actorId ?? null,
    sourceEventId: snapshot.sourceEventId,
    correlationId: snapshot.correlationId,
    occurredAt: toDate(snapshot.occurredAt),
  };
}

/** Drizzle {@link NotificationRepository} implementation. */
export class PgNotificationRepository implements NotificationRepository {
  readonly #db: NexoraDatabase;

  constructor(db: NexoraDatabase) {
    this.#db = db;
  }

  async save(notification: Notification): Promise<void> {
    const row = notificationSnapshotToRow(Notification.snapshot(notification));
    await this.#db
      .insert(notifications)
      .values(row)
      .onConflictDoUpdate({ target: notifications.id, set: row });
  }

  async findByIdAndRecipient(
    notificationId: string,
    recipientId: UserId,
    tenantId: TenantId,
  ): Promise<Notification | undefined> {
    const row = await this.#db.query.notifications.findFirst({
      where: and(
        eq(notifications.id, notificationId),
        eq(notifications.recipientId, recipientId),
        eq(notifications.tenantId, tenantId),
      ),
    });
    return row === undefined ? undefined : Notification.hydrate(rowToNotificationSnapshot(row));
  }

  async findBySourceEvent(
    sourceEventId: string,
    recipientId: UserId,
    tenantId: TenantId,
  ): Promise<Notification | undefined> {
    const row = await this.#db.query.notifications.findFirst({
      where: and(
        eq(notifications.sourceEventId, sourceEventId),
        eq(notifications.recipientId, recipientId),
        eq(notifications.tenantId, tenantId),
      ),
    });
    return row === undefined ? undefined : Notification.hydrate(rowToNotificationSnapshot(row));
  }

  async listByRecipient(
    recipientId: UserId,
    tenantId: TenantId,
    options?: { workspaceId?: WorkspaceId; limit?: number },
  ): Promise<readonly Notification[]> {
    // The inbox is recipient + tenant scoped. An explicit workspace narrows
    // it; omitting the workspace returns ALL of the recipient notifications
    // (org-scoped events carry no workspace and must remain visible).
    const conditions = [
      eq(notifications.recipientId, recipientId),
      eq(notifications.tenantId, tenantId),
    ];
    if (options?.workspaceId !== undefined) {
      conditions.push(eq(notifications.workspaceId, options.workspaceId));
    }
    const rows = await this.#db.query.notifications.findMany({
      where: and(...conditions),
      orderBy: (table, { desc }) => [desc(table.createdAt)],
      limit: options?.limit ?? 100,
    });
    return rows.map((row) => Notification.hydrate(rowToNotificationSnapshot(row)));
  }

  async countUnread(
    recipientId: UserId,
    tenantId: TenantId,
    options?: { workspaceId?: WorkspaceId },
  ): Promise<number> {
    const conditions = [
      eq(notifications.recipientId, recipientId),
      eq(notifications.tenantId, tenantId),
      eq(notifications.status, 'unread'),
    ];
    if (options?.workspaceId !== undefined) {
      conditions.push(eq(notifications.workspaceId, options.workspaceId));
    }
    const rows = await this.#db
      .select({ id: notifications.id })
      .from(notifications)
      .where(and(...conditions));
    return rows.length;
  }

  async markRead(
    notificationId: string,
    recipientId: UserId,
    tenantId: TenantId,
    now: string,
  ): Promise<boolean> {
    const existing = await this.findByIdAndRecipient(notificationId, recipientId, tenantId);
    if (existing === undefined) {
      return false;
    }
    const result = existing.markRead(now);
    if (!result.ok) {
      return false;
    }
    await this.save(result.notification);
    return true;
  }

  async markAllRead(
    recipientId: UserId,
    tenantId: TenantId,
    options?: { workspaceId?: WorkspaceId },
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

/** Drizzle {@link NotificationPreferencesRepository} implementation. */
export class PgNotificationPreferencesRepository implements NotificationPreferencesRepository {
  readonly #db: NexoraDatabase;

  constructor(db: NexoraDatabase) {
    this.#db = db;
  }

  async findByUser(
    userId: UserId,
    tenantId: TenantId,
  ): Promise<NotificationPreferences | undefined> {
    const row = await this.#db.query.notificationPreferences.findFirst({
      where: and(
        eq(notificationPreferences.userId, userId),
        eq(notificationPreferences.tenantId, tenantId),
      ),
    });
    return row === undefined
      ? undefined
      : NotificationPreferences.hydrate(rowToPreferencesSnapshot(row));
  }

  async save(preferences: NotificationPreferences): Promise<void> {
    const row = preferencesSnapshotToRow(NotificationPreferences.snapshot(preferences));
    await this.#db
      .insert(notificationPreferences)
      .values(row)
      .onConflictDoUpdate({ target: notificationPreferences.id, set: row });
  }
}

/** Drizzle {@link ActivityRepository} implementation. */
export class PgActivityRepository implements ActivityRepository {
  readonly #db: NexoraDatabase;

  constructor(db: NexoraDatabase) {
    this.#db = db;
  }

  async save(item: ActivityItem): Promise<void> {
    const row = activitySnapshotToRow(ActivityItem.snapshot(item));
    await this.#db
      .insert(activityItems)
      .values(row)
      .onConflictDoNothing({ target: activityItems.id });
  }

  async findBySourceEvent(
    sourceEventId: string,
    tenantId: TenantId,
  ): Promise<ActivityItem | undefined> {
    const row = await this.#db.query.activityItems.findFirst({
      where: and(
        eq(activityItems.sourceEventId, sourceEventId),
        eq(activityItems.tenantId, tenantId),
      ),
    });
    return row === undefined ? undefined : ActivityItem.hydrate(rowToActivitySnapshot(row));
  }

  async listByWorkspace(
    tenantId: TenantId,
    options?: { workspaceId?: WorkspaceId; limit?: number },
  ): Promise<readonly ActivityItem[]> {
    // Tenant-scoped read model. An explicit workspace narrows it; omitting
    // the workspace returns all of the tenant activity.
    const conditions = [eq(activityItems.tenantId, tenantId)];
    if (options?.workspaceId !== undefined) {
      conditions.push(eq(activityItems.workspaceId, options.workspaceId));
    }
    const rows = await this.#db.query.activityItems.findMany({
      where: and(...conditions),
      orderBy: (table, { desc }) => [desc(table.occurredAt)],
      limit: options?.limit ?? 100,
    });
    return rows.map((row) => ActivityItem.hydrate(rowToActivitySnapshot(row)));
  }
}
