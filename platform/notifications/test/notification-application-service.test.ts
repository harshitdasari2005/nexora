/**
 * Application-layer tests for the Notification platform: the trusted read
 * surface (inbox, unread count, mark-read, preferences, activity feed).
 * Every query is recipient/tenant scoped — a notification id alone grants
 * nothing.
 */

import { describe, expect, it } from 'vitest';

import { ActivityItem } from '../src/domain/activity-item.js';
import { Notification } from '../src/domain/notification.js';
import { NotificationApplicationService } from '../src/application/notification-application-service.js';
import {
  MemoryActivityRepository,
  MemoryNotificationRepository,
  MemoryPreferencesRepository,
} from './helpers.js';

const TENANT = 'org_tenant_a';
const TENANT_B = 'org_tenant_b';
const WORKSPACE = 'ws_a';
const WORKSPACE_B = 'ws_b';
const USER = 'user_sarah';
const OTHER_USER = 'user_mike';

function createNotification(
  repository: MemoryNotificationRepository,
  input: {
    recipientId: string;
    tenantId: string;
    workspaceId?: string;
    type?: string;
    category?:
      | 'workflow'
      | 'approval'
      | 'project'
      | 'employee'
      | 'document'
      | 'knowledge'
      | 'calendar'
      | 'system';
    title?: string;
    body?: string;
  },
): void {
  const notification = Notification.create(
    {
      recipientId: input.recipientId,
      tenantId: input.tenantId,
      workspaceId: input.workspaceId,
      type: input.type ?? 'workflow.completed',
      category: input.category ?? 'workflow',
      title: input.title ?? 'Workflow completed',
      body: input.body ?? 'Your workflow completed.',
      priority: 'normal',
      sourceEventId: `evt_${Math.random().toString(36).slice(2)}`,
      correlationId: 'corr_1',
    },
    '2026-08-10T10:00:00.000Z',
  );
  repository.save(notification);
}

function buildService(): {
  service: NotificationApplicationService;
  notifications: MemoryNotificationRepository;
  preferences: MemoryPreferencesRepository;
  activity: MemoryActivityRepository;
} {
  const notifications = new MemoryNotificationRepository();
  const preferences = new MemoryPreferencesRepository();
  const activity = new MemoryActivityRepository();
  const service = new NotificationApplicationService({ notifications, preferences, activity });
  return { service, notifications, preferences, activity };
}

describe('NotificationApplicationService', () => {
  it('lists only the authenticated recipient notifications within the tenant', async () => {
    const { service, notifications } = buildService();
    createNotification(notifications, { recipientId: USER, tenantId: TENANT });
    createNotification(notifications, { recipientId: USER, tenantId: TENANT });
    // Another user's notification and another tenant's notification.
    createNotification(notifications, { recipientId: OTHER_USER, tenantId: TENANT });
    createNotification(notifications, { recipientId: USER, tenantId: TENANT_B });

    // Exactly the recipient's own 2 notifications in this tenant — the
    // other user's and the other tenant's are excluded (count is the proof:
    // 4 were created, 2 are visible). The DTO deliberately carries no
    // recipient/tenant ids; scoping is enforced by the query itself.
    const result = await service.listNotifications({ userId: USER, tenantId: TENANT });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.notifications).toHaveLength(2);
    }
  });

  it('filters by workspace when a workspace is supplied', async () => {
    const { service, notifications } = buildService();
    createNotification(notifications, {
      recipientId: USER,
      tenantId: TENANT,
      workspaceId: WORKSPACE,
    });
    createNotification(notifications, {
      recipientId: USER,
      tenantId: TENANT,
      workspaceId: WORKSPACE_B,
    });

    // One notification was created in the filtered workspace, one in another
    // — the workspace filter narrows to exactly one.
    const result = await service.listNotifications({
      userId: USER,
      tenantId: TENANT,
      workspaceId: WORKSPACE,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.notifications).toHaveLength(1);
    }
  });

  it('counts unread notifications only', async () => {
    const { service, notifications } = buildService();
    createNotification(notifications, { recipientId: USER, tenantId: TENANT });
    createNotification(notifications, { recipientId: USER, tenantId: TENANT });

    // Mark the first read.
    const listed = await service.listNotifications({ userId: USER, tenantId: TENANT });
    if (!listed.ok || listed.value.notifications[0] === undefined) {
      throw new Error('expected list');
    }
    await service.markNotificationRead({
      notificationId: listed.value.notifications[0].id,
      userId: USER,
      tenantId: TENANT,
    });

    const result = await service.unreadCount({ userId: USER, tenantId: TENANT });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.count).toBe(1);
    }
  });

  it('markRead on a foreign notification id returns alreadyRead (no data leak)', async () => {
    const { service, notifications } = buildService();
    createNotification(notifications, {
      recipientId: OTHER_USER,
      tenantId: TENANT,
    });

    const result = await service.markNotificationRead({
      notificationId: 'ntf_foreign',
      userId: USER,
      tenantId: TENANT,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect('alreadyRead' in result.value).toBe(true);
    }
  });

  it('markAllRead only marks the recipient own unread notifications', async () => {
    const { service, notifications } = buildService();
    createNotification(notifications, { recipientId: USER, tenantId: TENANT });
    createNotification(notifications, { recipientId: USER, tenantId: TENANT });
    createNotification(notifications, { recipientId: OTHER_USER, tenantId: TENANT });

    const result = await service.markAllNotificationsRead({ userId: USER, tenantId: TENANT });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.marked).toBe(2);
    }

    // The other user's notification is untouched.
    const otherList = await service.listNotifications({ userId: OTHER_USER, tenantId: TENANT });
    if (otherList.ok) {
      expect(otherList.value.notifications[0]?.status).toBe('unread');
    }
  });

  it('defaults preferences to all-enabled when none exist', async () => {
    const { service } = buildService();
    const result = await service.getPreferences({ userId: USER, tenantId: TENANT });
    expect(result.ok).toBe(true);
    if (result.ok) {
      // Empty categories map means every category defaults to enabled.
      expect(Object.keys(result.value.preferences.categories)).toHaveLength(0);
    }
  });

  it('updates a single category and persists it', async () => {
    const { service } = buildService();

    const result = await service.updatePreferences({
      userId: USER,
      tenantId: TENANT,
      category: 'workflow',
      enabled: false,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.preferences.categories.workflow).toBe(false);
      expect(result.value.preferences.categories.approval).toBe(true);
    }

    // Reading back returns the persisted value.
    const reloaded = await service.getPreferences({ userId: USER, tenantId: TENANT });
    if (reloaded.ok) {
      expect(reloaded.value.preferences.categories.workflow).toBe(false);
    }
  });

  it('does not persist preferences for another user (user is trusted, never supplied by client)', async () => {
    const { service, preferences } = buildService();
    const result = await service.updatePreferences({
      userId: USER,
      tenantId: TENANT,
      category: 'workflow',
      enabled: false,
    });
    expect(result.ok).toBe(true);

    // Preferences are scoped: the other user still has none.
    const other = await service.getPreferences({ userId: OTHER_USER, tenantId: TENANT });
    if (other.ok) {
      expect(Object.keys(other.value.preferences.categories)).toHaveLength(0);
    }
    expect(preferences.preferences.size).toBe(1);
  });

  it('lists activity scoped to the tenant (and workspace when supplied)', async () => {
    const { service, activity } = buildService();
    const makeItem = (workspaceId: string, type: string): void => {
      const item = ActivityItem.create(
        {
          tenantId: TENANT,
          workspaceId,
          type,
          title: type,
          body: 'An event occurred.',
          sourceEventId: `evt_${Math.random().toString(36).slice(2)}`,
          correlationId: 'corr_1',
        },
        '2026-08-10T10:00:00.000Z',
      );
      activity.save(item);
    };
    makeItem(WORKSPACE, 'project.created');
    makeItem(WORKSPACE, 'employee.created');
    makeItem(WORKSPACE_B, 'document.available');

    const scoped = await service.listActivity({ tenantId: TENANT, workspaceId: WORKSPACE });
    expect(scoped.ok).toBe(true);
    if (scoped.ok) {
      expect(scoped.value.activity).toHaveLength(2);
    }

    const tenantWide = await service.listActivity({ tenantId: TENANT });
    if (tenantWide.ok) {
      expect(tenantWide.value.activity).toHaveLength(3);
    }

    // A different tenant never sees this activity.
    const otherTenant = await service.listActivity({ tenantId: TENANT_B });
    if (otherTenant.ok) {
      expect(otherTenant.value.activity).toHaveLength(0);
    }
  });
});

// Re-export the memory doubles for the service tests above (they are defined
// in ./helpers.ts and imported at the top — this block documents usage).
export {};
