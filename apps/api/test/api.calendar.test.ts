/**
 * Calendar vertical slice API tests: create/list/get/update/cancel calendar
 * events through the REST surface (`fastify.inject`).
 *
 * Security contract under test: organization membership + workspace
 * membership are the authorization boundaries. A user who is a member of
 * org A / workspace W1 can never read or mutate an entry in workspace W2 or
 * in another tenant; a forged organization/workspace resolves to 403; a
 * foreign entry id resolves to 404 (never data).
 */

import { describe, expect, it } from 'vitest';

import {
  buildTestApp,
  chatClient,
  login,
  onboardOrgAndWorkspace,
  type ChatClient,
} from './helpers.js';
import { FakeOidcGateway } from './fakes.js';
import type { FakeCalendarEntryRepository } from './fakes.js';

/** A calendar-event payload for creation. */
function eventPayload(overrides: Record<string, unknown> = {}) {
  return {
    title: 'Project Review',
    startsAt: '2026-09-01T15:00:00.000Z',
    endsAt: '2026-09-01T16:00:00.000Z',
    ...overrides,
  };
}

/** The number of calendar entries in the fake repository. */
function entryCount(client: ChatClient): number {
  return (client.repos.calendarEvents as FakeCalendarEntryRepository).entries.size;
}

describe('Calendar API — create and read', () => {
  it('creates a calendar event in the authorized workspace', async () => {
    const client = await chatClient();
    const { organizationId, workspaceId } = await onboardOrgAndWorkspace(client);

    const response = await client.post('/api/calendar/events', {
      organizationId,
      workspaceId,
      ...eventPayload(),
    });
    expect(response.statusCode).toBe(201);
    const body = response.json() as { event: Record<string, unknown> };
    expect(body.event.title).toBe('Project Review');
    expect(body.event.status).toBe('scheduled');
    expect(body.event.workspaceId).toBe(workspaceId);

    const listed = await client.get(
      `/api/calendar/events?organizationId=${organizationId}&workspaceId=${workspaceId}`,
    );
    expect(listed.statusCode).toBe(200);
    const listBody = listed.json() as { events: Record<string, unknown>[] };
    expect(listBody.events).toHaveLength(1);
    expect(listBody.events[0]?.title).toBe('Project Review');
  });

  it('rejects a malformed payload with 400 and no mutation', async () => {
    const client = await chatClient();
    const { organizationId, workspaceId } = await onboardOrgAndWorkspace(client);

    const response = await client.post('/api/calendar/events', {
      organizationId,
      workspaceId,
      ...eventPayload({ title: '' }),
    });
    expect(response.statusCode).toBe(400);
    expect(entryCount(client)).toBe(0);
  });
});

describe('Calendar API — update and cancel', () => {
  it('reschedules and then cancels an entry through the owning scope', async () => {
    const client = await chatClient();
    const { organizationId, workspaceId } = await onboardOrgAndWorkspace(client);
    const created = await client.post('/api/calendar/events', {
      organizationId,
      workspaceId,
      ...eventPayload(),
    });
    const entryId = (created.json() as { event: { id: string } }).event.id;

    const updated = await client.patch(`/api/calendar/events/${entryId}`, {
      organizationId,
      workspaceId,
      ...eventPayload({
        title: 'Mobile Banking Review',
        startsAt: '2026-09-02T10:00:00.000Z',
        endsAt: '2026-09-02T11:00:00.000Z',
      }),
    });
    expect(updated.statusCode).toBe(200);
    expect((updated.json() as { event: { title: string } }).event.title).toBe(
      'Mobile Banking Review',
    );

    const cancelled = await client.postEmpty(`/api/calendar/events/${entryId}/cancel`);
    expect(cancelled.statusCode).toBe(400);

    const cancelledWithBody = await client.post(`/api/calendar/events/${entryId}/cancel`, {
      organizationId,
      workspaceId,
    });
    expect(cancelledWithBody.statusCode).toBe(200);
    expect((cancelledWithBody.json() as { event: { status: string } }).event.status).toBe(
      'cancelled',
    );

    // A cancelled entry cannot be rescheduled (422 business rule).
    const lateUpdate = await client.patch(`/api/calendar/events/${entryId}`, {
      organizationId,
      workspaceId,
      ...eventPayload({ title: 'Too Late' }),
    });
    expect(lateUpdate.statusCode).toBe(422);
  });

  it('returns 404 for an unknown entry id', async () => {
    const client = await chatClient();
    const { organizationId, workspaceId } = await onboardOrgAndWorkspace(client);
    const response = await client.patch('/api/calendar/events/cal_00000000-0000-4000-8000-000000000000', {
      organizationId,
      workspaceId,
      ...eventPayload(),
    });
    expect(response.statusCode).toBe(404);
  });
});

describe('Calendar API — authorization boundaries', () => {
  it('rejects a forged organization scope with 403', async () => {
    const client = await chatClient();
    const { workspaceId } = await onboardOrgAndWorkspace(client);
    const response = await client.post('/api/calendar/events', {
      organizationId: 'org_alien_0000',
      workspaceId,
      ...eventPayload(),
    });
    expect(response.statusCode).toBe(403);
    expect(entryCount(client)).toBe(0);
  });

  it('rejects a non-member workspace scope with 403', async () => {
    const client = await chatClient();
    const { organizationId } = await onboardOrgAndWorkspace(client);
    const response = await client.post('/api/calendar/events', {
      organizationId,
      workspaceId: 'ws_alien_0000',
      ...eventPayload(),
    });
    expect(response.statusCode).toBe(403);
    expect(entryCount(client)).toBe(0);
  });

  it('a member of workspace A cannot read workspace B entries (403)', async () => {
    const { app, repos } = await buildTestApp({ oidc: new FakeOidcGateway() });
    const session = await login(app);
    const client: ChatClient = {
      app,
      session,
      store: null as never,
      repos,
      get(path) {
        return app.inject({ method: 'GET', url: path, headers: { cookie: session } });
      },
      post(path, body) {
        return app.inject({
          method: 'POST',
          url: path,
          headers: { cookie: session, 'content-type': 'application/json' },
          payload: body,
        });
      },
      put(path, body) {
        return app.inject({
          method: 'PUT',
          url: path,
          headers: { cookie: session, 'content-type': 'application/json' },
          payload: body,
        });
      },
      postEmpty(path) {
        return app.inject({
          method: 'POST',
          url: path,
          headers: { cookie: session, 'content-type': 'application/json' },
          payload: {},
        });
      },
    };
    const { organizationId, workspaceId } = await onboardOrgAndWorkspace(client);
    const created = await client.post('/api/calendar/events', {
      organizationId,
      workspaceId,
      ...eventPayload(),
    });
    const entryId = (created.json() as { event: { id: string } }).event.id;

    // A forged cross-workspace read (same org, foreign workspace) → 403.
    const forged = await client.get(
      `/api/calendar/events/${entryId}?organizationId=${organizationId}&workspaceId=ws_alien_0000`,
    );
    expect(forged.statusCode).toBe(403);
  });

  it('rejects unauthenticated access with 401', async () => {
    const { app } = await buildTestApp({ oidc: new FakeOidcGateway() });
    const response = await app.inject({
      method: 'GET',
      url: '/api/calendar/events?organizationId=org_x&workspaceId=ws_x',
    });
    expect(response.statusCode).toBe(401);
  });
});
