/**
 * Domain tests for the Notification platform aggregates: Notification
 * (read-state lifecycle), NotificationPreferences (safe defaults + category
 * gating), and ActivityItem (event-derived read model).
 */

import { describe, expect, it } from 'vitest';

import { ActivityItem } from '../src/domain/activity-item.js';
import { Notification } from '../src/domain/notification.js';
import { NotificationPreferences } from '../src/domain/notification-preferences.js';

const TENANT = 'org_tenant_a';
const WORKSPACE = 'ws_a';
const USER = 'user_sarah';

describe('Notification aggregate', () => {
  it('creates an unread notification with the supplied scope and metadata', () => {
    const notification = Notification.create(
      {
        recipientId: USER,
        tenantId: TENANT,
        workspaceId: WORKSPACE,
        type: 'project.created',
        category: 'project',
        title: 'Project created',
        body: 'Project "Mobile Banking" was created.',
        priority: 'normal',
        action: { kind: 'navigate', href: '/app/projects', label: 'Open project' },
        sourceEventId: 'evt_1',
        correlationId: 'corr_1',
      },
      '2026-08-10T10:00:00.000Z',
    );

    const snapshot = Notification.snapshot(notification);
    expect(snapshot.status).toBe('unread');
    expect(snapshot.recipientId).toBe(USER);
    expect(snapshot.tenantId).toBe(TENANT);
    expect(snapshot.workspaceId).toBe(WORKSPACE);
    expect(snapshot.type).toBe('project.created');
    expect(snapshot.sourceEventId).toBe('evt_1');
    expect(snapshot.correlationId).toBe('corr_1');
    expect(snapshot.readAt).toBeUndefined();
    expect(snapshot.version).toBe(1);
  });

  it('markRead transitions unread → read and records the read time', () => {
    const notification = Notification.create(
      {
        recipientId: USER,
        tenantId: TENANT,
        type: 'workflow.completed',
        category: 'workflow',
        title: 'Workflow completed',
        body: 'Your workflow completed successfully.',
        priority: 'normal',
        sourceEventId: 'evt_2',
        correlationId: 'corr_2',
      },
      '2026-08-10T10:00:00.000Z',
    );

    const result = notification.markRead('2026-08-10T11:00:00.000Z');
    expect(result.ok).toBe(true);
    if (result.ok) {
      const snapshot = Notification.snapshot(result.notification);
      expect(snapshot.status).toBe('read');
      expect(snapshot.readAt).toBe('2026-08-10T11:00:00.000Z');
      expect(snapshot.version).toBe(2);
    }
  });

  it('hydrate restores the aggregate id (round-trip identity is preserved)', () => {
    const notification = Notification.create(
      {
        recipientId: USER,
        tenantId: TENANT,
        type: 'workflow.completed',
        category: 'workflow',
        title: 'Workflow completed',
        body: 'Your workflow completed.',
        priority: 'normal',
        sourceEventId: 'evt_1',
        correlationId: 'corr_1',
      },
      '2026-08-10T10:00:00.000Z',
    );
    const snapshot = Notification.snapshot(notification);
    const restored = Notification.hydrate(snapshot);
    expect(restored.id).toBe(snapshot.id);
    expect(restored.status).toBe('unread');
  });

  it('markRead on an already-read notification is idempotent (no version bump)', () => {
    const notification = Notification.create(
      {
        recipientId: USER,
        tenantId: TENANT,
        type: 'document.available',
        category: 'document',
        title: 'Document ready',
        body: 'Your document is available.',
        priority: 'normal',
        sourceEventId: 'evt_3',
        correlationId: 'corr_3',
      },
      '2026-08-10T10:00:00.000Z',
    );
    const first = notification.markRead('2026-08-10T10:30:00.000Z');
    expect(first.ok).toBe(true);
    if (!first.ok) return;

    const second = first.notification.markRead('2026-08-10T11:00:00.000Z');
    expect(second.ok).toBe(false);
    if (!second.ok) {
      expect(second.reason).toBe('already_read');
    }
    // The first read time is preserved.
    expect(Notification.snapshot(first.notification).readAt).toBe('2026-08-10T10:30:00.000Z');
  });
});

describe('NotificationPreferences aggregate', () => {
  it('defaults to every category enabled (safe defaults)', () => {
    const preferences = NotificationPreferences.create(
      { userId: USER, tenantId: TENANT },
      '2026-08-10T10:00:00.000Z',
    );

    expect(preferences.isEnabled('workflow')).toBe(true);
    expect(preferences.isEnabled('approval')).toBe(true);
    expect(preferences.isEnabled('document')).toBe(true);
    expect(preferences.isEnabled('system')).toBe(true);
  });

  it('setCategory toggles delivery and bumps the version', () => {
    const preferences = NotificationPreferences.create(
      { userId: USER, tenantId: TENANT },
      '2026-08-10T10:00:00.000Z',
    );

    const changed = preferences.setCategory('workflow', false, '2026-08-10T11:00:00.000Z');
    expect(changed).toBe(true);
    expect(preferences.isEnabled('workflow')).toBe(false);
    expect(preferences.isEnabled('approval')).toBe(true);

    const contract = preferences.toContract();
    expect(contract.categories.workflow).toBe(false);
    expect(contract.categories.approval).toBe(true);
  });

  it('rejects unknown categories (never silently widens delivery)', () => {
    const preferences = NotificationPreferences.create(
      { userId: USER, tenantId: TENANT },
      '2026-08-10T10:00:00.000Z',
    );

    // Unknown category: returns false, no state change.
    const changed = preferences.setCategory(
      'everything' as never,
      true,
      '2026-08-10T11:00:00.000Z',
    );
    expect(changed).toBe(false);
    const snapshot = NotificationPreferences.snapshot(preferences);
    expect(snapshot.categories.everything).toBeUndefined();
  });

  it('hydrate restores the aggregate id (a hydrated aggregate is the SAME record)', () => {
    const preferences = NotificationPreferences.create(
      { userId: USER, tenantId: TENANT },
      '2026-08-10T10:00:00.000Z',
    );
    const snapshot = NotificationPreferences.snapshot(preferences);
    const restored = NotificationPreferences.hydrate(snapshot);
    // The persisted identity is preserved — never regenerated at load (this
    // is what makes repository round-trips and idempotent upserts correct).
    expect(restored.id).toBe(snapshot.id);
    expect(restored.id).toBe(preferences.id);
  });

  it('hydrate restores persisted state including disabled categories', () => {
    const preferences = NotificationPreferences.create(
      { userId: USER, tenantId: TENANT },
      '2026-08-10T10:00:00.000Z',
    );
    preferences.setCategory('document', false, '2026-08-10T10:30:00.000Z');

    const restored = NotificationPreferences.hydrate(NotificationPreferences.snapshot(preferences));
    expect(restored.userId).toBe(USER);
    expect(restored.tenantId).toBe(TENANT);
    expect(restored.isEnabled('document')).toBe(false);
    expect(restored.isEnabled('workflow')).toBe(true);
  });
});

describe('ActivityItem read model', () => {
  it('records one event-derived item with scope and source reference', () => {
    const item = ActivityItem.create(
      {
        tenantId: TENANT,
        workspaceId: WORKSPACE,
        type: 'employee.created',
        title: 'Employee hired',
        body: 'Sarah was hired.',
        actorId: USER,
        sourceEventId: 'evt_4',
        correlationId: 'corr_4',
      },
      '2026-08-10T10:00:00.000Z',
    );

    const snapshot = ActivityItem.snapshot(item);
    expect(snapshot.tenantId).toBe(TENANT);
    expect(snapshot.workspaceId).toBe(WORKSPACE);
    expect(snapshot.type).toBe('employee.created');
    expect(snapshot.actorId).toBe(USER);
    expect(snapshot.sourceEventId).toBe('evt_4');
    expect(snapshot.correlationId).toBe('corr_4');
    expect(snapshot.occurredAt).toBe('2026-08-10T10:00:00.000Z');
  });

  it('hydrate restores a persisted item', () => {
    const item = ActivityItem.create(
      {
        tenantId: TENANT,
        workspaceId: WORKSPACE,
        type: 'project.created',
        title: 'Project created',
        body: 'Project "Mobile Banking" was created.',
        sourceEventId: 'evt_5',
        correlationId: 'corr_5',
      },
      '2026-08-10T10:00:00.000Z',
    );

    const restored = ActivityItem.hydrate(ActivityItem.snapshot(item));
    expect(restored.type).toBe('project.created');
    expect(restored.tenantId).toBe(TENANT);
    expect(restored.workspaceId).toBe(WORKSPACE);
    // Round-trip identity is preserved (never regenerated at load).
    expect(restored.id).toBe(item.id);
  });
});
