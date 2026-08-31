/**
 * Notification + Activity Feed vertical slice E2E at the API boundary
 * (`fastify.inject`): business event → event backbone → notification
 * consumer → recipient inbox + activity feed. Covers the happy path
 * (project.created produces a notification), read lifecycle, preferences,
 * activity scoping, and the security contract (cross-tenant isolation,
 * forged ids, client-supplied identity rejection).
 *
 * Note: `project.created` events are organization-scoped (projects do not
 * belong to a workspace), so the inbox/feed assertions use the organization
 * scope — a workspace filter would correctly exclude them.
 */

import { describe, expect, it } from 'vitest';

import { chatClient, currentUserId, onboardOrgAndWorkspace } from './helpers.js';
import { isActivityInScope, isNotificationForRecipient } from '../src/routes/notifications.js';

/** The notification payload returned by GET /api/notifications. */
interface NotificationListResponse {
  notifications: Array<{
    id: string;
    type: string;
    category: string;
    title: string;
    body: string;
    priority: string;
    status: string;
    action?: { kind: string; href: string; label: string };
    createdAt: string;
    readAt?: string;
  }>;
}

/** The activity payload returned by GET /api/activity. */
interface ActivityListResponse {
  activity: Array<{
    id: string;
    type: string;
    title: string;
    body: string;
    actorId?: string;
    occurredAt: string;
  }>;
}

describe('Notification Center + Activity Feed (E2E via inject)', () => {
  it('a business event (project.created) produces a recipient notification and activity item', async () => {
    const client = await chatClient();
    const { organizationId } = await onboardOrgAndWorkspace(client);

    // Trigger the business event through the canonical API surface.
    const created = await client.post('/api/projects', {
      organizationId,
      name: 'Mobile Banking',
      description: 'Core banking platform',
    });
    expect(created.statusCode).toBe(201);

    // The event flowed: the actor (current user) now has an inbox entry.
    const inbox = await client.get(`/api/notifications?organizationId=${organizationId}`);
    expect(inbox.statusCode).toBe(200);
    const inboxBody = inbox.json() as NotificationListResponse;
    const notification = inboxBody.notifications.find((n) => n.type === 'project.created');
    expect(notification).toBeDefined();
    expect(notification?.title).toBe('Project created');
    expect(notification?.body).toContain('Mobile Banking');
    expect(notification?.status).toBe('unread');
    expect(notification?.action?.href).toBe('/app/projects');

    // The organization activity feed records the same event.
    const feed = await client.get(`/api/activity?organizationId=${organizationId}`);
    expect(feed.statusCode).toBe(200);
    const feedBody = feed.json() as ActivityListResponse;
    const activity = feedBody.activity.find((item) => item.type === 'project.created');
    expect(activity).toBeDefined();
    expect(activity?.body).toContain('Mobile Banking');
  });

  it('unread count reflects the inbox and mark-read reduces it', async () => {
    const client = await chatClient();
    const { organizationId } = await onboardOrgAndWorkspace(client);

    await client.post('/api/projects', { organizationId, name: 'Mobile Banking' });
    await client.post('/api/projects', { organizationId, name: 'Loyalty Engine' });

    const count = await client.get(
      `/api/notifications/unread-count?organizationId=${organizationId}`,
    );
    expect(count.statusCode).toBe(200);
    expect(count.json()).toMatchObject({ count: 2 });

    // Mark the newest read.
    const inbox = await client.get(`/api/notifications?organizationId=${organizationId}`);
    const notification = (inbox.json() as NotificationListResponse).notifications[0];
    expect(notification).toBeDefined();

    const read = await client.postEmpty(`/api/notifications/${notification?.id}/read`);
    expect(read.statusCode).toBe(200);

    const after = await client.get(
      `/api/notifications/unread-count?organizationId=${organizationId}`,
    );
    expect(after.json()).toMatchObject({ count: 1 });
  });

  it('mark-read on a foreign or unknown notification id returns 404 (no enumeration)', async () => {
    const client = await chatClient();
    const { organizationId } = await onboardOrgAndWorkspace(client);

    const read = await client.postEmpty(
      `/api/notifications/ntf_does_not_exist/read?organizationId=${organizationId}`,
    );
    expect(read.statusCode).toBe(404);
    expect((read.json() as { error?: { code?: string } }).error?.code).toBe('NOT_FOUND');
  });

  it('mark-all-read clears the unread count', async () => {
    const client = await chatClient();
    const { organizationId } = await onboardOrgAndWorkspace(client);

    await client.post('/api/projects', { organizationId, name: 'Mobile Banking' });
    await client.post('/api/projects', { organizationId, name: 'Loyalty Engine' });

    const marked = await client.postEmpty(
      `/api/notifications/read-all?organizationId=${organizationId}`,
    );
    expect(marked.statusCode).toBe(200);
    expect(marked.json()).toMatchObject({ marked: 2 });

    const count = await client.get(
      `/api/notifications/unread-count?organizationId=${organizationId}`,
    );
    expect(count.json()).toMatchObject({ count: 0 });
  });

  it('preferences default to all-enabled and persist per category', async () => {
    const client = await chatClient();
    const { organizationId } = await onboardOrgAndWorkspace(client);

    const initial = await client.get(
      `/api/notifications/preferences?organizationId=${organizationId}`,
    );
    expect(initial.statusCode).toBe(200);
    expect(initial.json()).toMatchObject({ preferences: { categories: {} } });

    const updated = await client.put(
      `/api/notifications/preferences?organizationId=${organizationId}`,
      {
        category: 'workflow',
        enabled: false,
      },
    );
    expect(updated.statusCode).toBe(200);
    const body = updated.json() as {
      preferences: { categories: Record<string, boolean> };
    };
    expect(body.preferences.categories.workflow).toBe(false);
    expect(body.preferences.categories.approval).toBe(true);

    // Persisted across requests.
    const reloaded = await client.get(
      `/api/notifications/preferences?organizationId=${organizationId}`,
    );
    const reloadedBody = reloaded.json() as {
      preferences: { categories: Record<string, boolean> };
    };
    expect(reloadedBody.preferences.categories.workflow).toBe(false);
  });

  it('a disabled category suppresses delivery but keeps the activity record (preferences are presentation-only)', async () => {
    const client = await chatClient();
    const { organizationId } = await onboardOrgAndWorkspace(client);

    await client.put(`/api/notifications/preferences?organizationId=${organizationId}`, {
      category: 'project',
      enabled: false,
    });
    await client.post('/api/projects', { organizationId, name: 'Mobile Banking' });

    const inbox = await client.get(`/api/notifications?organizationId=${organizationId}`);
    const inboxBody = inbox.json() as NotificationListResponse;
    expect(inboxBody.notifications.filter((n) => n.type === 'project.created')).toHaveLength(0);

    // The business action still happened and activity still records it.
    const feed = await client.get(`/api/activity?organizationId=${organizationId}`);
    const feedBody = feed.json() as ActivityListResponse;
    expect(feedBody.activity.some((item) => item.type === 'project.created')).toBe(true);
  });
});

describe('Notification security (E2E)', () => {
  it('a user never sees another user notifications (recipient is always the authenticated user)', async () => {
    // Two distinct users; the notification produced by user A must never be
    // visible through user B session.
    const clientA = await chatClient();
    const { organizationId } = await onboardOrgAndWorkspace(clientA);
    await clientA.post('/api/projects', { organizationId, name: 'Mobile Banking' });

    const clientB = await chatClient();
    // User B is not a member of user A organization → 403 (no data leaked).
    const inboxB = await clientB.get(`/api/notifications?organizationId=${organizationId}`);
    expect(inboxB.statusCode).toBe(403);
  });

  it('a client-supplied userId cannot target another user inbox', async () => {
    const client = await chatClient();
    const { organizationId } = await onboardOrgAndWorkspace(client);
    const actor = currentUserId(client);

    await client.post('/api/projects', { organizationId, name: 'Mobile Banking' });

    // The endpoint has no userId parameter — supplying one changes nothing.
    const forged = await client.get(
      `/api/notifications?organizationId=${organizationId}&userId=user_victim`,
    );
    expect(forged.statusCode).toBe(200);
    const body = forged.json() as NotificationListResponse;
    // The authenticated user still sees exactly their own notification.
    expect(body.notifications.filter((n) => n.type === 'project.created')).toHaveLength(1);
    expect(actor.length).toBeGreaterThan(0);
  });

  it('a forged workspace id resolves to 403, never to another workspace notifications', async () => {
    const client = await chatClient();
    const { organizationId } = await onboardOrgAndWorkspace(client);

    const forged = await client.get(
      `/api/notifications?organizationId=${organizationId}&workspaceId=ws_forged`,
    );
    expect(forged.statusCode).toBe(403);
  });

  it('a forged organization (tenant) id resolves to 403', async () => {
    const client = await chatClient();
    await onboardOrgAndWorkspace(client);

    const forged = await client.get(`/api/notifications?organizationId=org_foreign_tenant`);
    expect(forged.statusCode).toBe(403);
  });

  it('an unauthenticated request is rejected', async () => {
    const client = await chatClient();
    await onboardOrgAndWorkspace(client);

    const anon = await client.app.inject({ method: 'GET', url: '/api/notifications' });
    expect(anon.statusCode).toBe(401);
  });
});

describe('SSE stream filter predicates (GET /api/notifications/stream)', () => {
  it('forwards a notification only to its own recipient', () => {
    expect(isNotificationForRecipient('usr_alice', 'usr_alice')).toBe(true);
    expect(isNotificationForRecipient('usr_alice', 'usr_bob')).toBe(false);
  });

  it('forwards an activity event only when the item tenant matches the connection tenant', () => {
    expect(isActivityInScope('tnt_acme', 'tnt_acme')).toBe(true);
    expect(isActivityInScope('tnt_acme', 'tnt_other')).toBe(false);
  });

  it('never forwards activity against the identity bootstrap tenant (the regression)', () => {
    // `request.auth.tenantId` is always `tnt_platform` for OIDC users; real
    // activity items carry a real org id. Comparing the two must be false —
    // the connection tenant has to be RESOLVED from membership first.
    expect(isActivityInScope('tnt_acme', 'tnt_platform')).toBe(false);
  });

  it('forwards nothing when the connection tenant could not be resolved (fail closed)', () => {
    expect(isActivityInScope('tnt_acme', undefined)).toBe(false);
  });
});
