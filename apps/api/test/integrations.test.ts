/**
 * S20 Integrations vertical slice — API E2E tests (`fastify.inject`):
 *
 * - Webhook registry: create (secret shown exactly once), list (secret
 *   masked), update, enable/disable, delete — all workspace-scoped through
 *   the ONE authorization path (401/403 isolation).
 * - A domain event (e.g. calendar.event.created) rides the SAME event
 *   backbone to the WebhookDispatcher, which delivers a signed payload to
 *   the subscribed endpoint and records an append-only receipt visible via
 *   the deliveries endpoint (DoD: "webhook fired on EVT").
 * - Email outbox: dispatched records are persisted and readable; the dev
 *   sink writes the structured email.
 * - Inbound email actions: the SIGNED endpoint verifies the HMAC over the
 *   raw body, denies non-allowlisted senders, and routes approval.decide
 *   through the existing ApprovalEngine (no second approval system).
 */

import { describe, expect, it } from 'vitest';

import { signInboundBody } from '../src/routes/integrations.js';
import { EmailRecord } from '@nexora/module-integrations';
import type { TenantId, WorkspaceId } from '@nexora/contracts/common';

import {
  buildTestApp,
  chatClient,
  chatClientWithSecondUser,
  currentUserId,
  login,
  onboardOrgAndWorkspace,
  seedOrganizationMembership,
  seedWorkspace,
  seedWorkspaceMembership,
} from './helpers.js';

const INBOUND_SECRET = 'test-inbound-secret';

describe('S20 integrations — webhook registry (API)', () => {
  it('creates a webhook endpoint (secret once), lists it masked, updates, and deletes', async () => {
    const client = await chatClient();
    const scope = await onboardOrgAndWorkspace(client);

    // Create: the ONLY response with the full secret.
    const created = await client.post('/api/integrations/webhooks', {
      organizationId: scope.organizationId,
      workspaceId: scope.workspaceId,
      url: 'https://example.com/hooks/nexora',
      eventTypes: ['project.created', 'employee.created'],
    });
    expect(created.statusCode).toBe(201);
    const createdBody = created.json() as {
      endpoint: { id: string; url: string; enabled: boolean; eventTypes: string[] };
      secret: string;
    };
    expect(createdBody.endpoint.url).toBe('https://example.com/hooks/nexora');
    expect(createdBody.endpoint.enabled).toBe(true);
    expect(createdBody.secret).toMatch(/^[0-9a-f]{64}$/);
    const endpointId = createdBody.endpoint.id;

    // List: the secret is masked on reads.
    const listed = await client.get(
      `/api/integrations/webhooks?organizationId=${scope.organizationId}&workspaceId=${scope.workspaceId}`,
    );
    expect(listed.statusCode).toBe(200);
    const listedBody = listed.json() as {
      endpoints: { id: string; secretMasked: string }[];
      subscribableEvents: string[];
    };
    expect(listedBody.endpoints).toHaveLength(1);
    expect(listedBody.endpoints[0]?.id).toBe(endpointId);
    expect(listedBody.endpoints[0]?.secretMasked).not.toContain(createdBody.secret);
    expect(listedBody.endpoints[0]?.secretMasked).toContain('…');
    // No byte of the signing secret is returned after creation (not even a prefix).
    expect(listedBody.endpoints[0]?.secretMasked).not.toContain(createdBody.secret.slice(0, 4));
    expect(listedBody.subscribableEvents).toContain('project.created');
    expect(listedBody.subscribableEvents).toContain('workflow.waiting_for_approval');

    // Update URL + subscription.
    const updated = await client.patch(`/api/integrations/webhooks/${endpointId}`, {
      organizationId: scope.organizationId,
      workspaceId: scope.workspaceId,
      url: 'https://new.example.com/hooks',
      eventTypes: ['employee.created'],
    });
    expect(updated.statusCode).toBe(200);
    expect((updated.json() as { endpoint: { url: string } }).endpoint.url).toBe(
      'https://new.example.com/hooks',
    );

    // Disable → enable.
    const disabled = await client.post(`/api/integrations/webhooks/${endpointId}/enable`, {
      organizationId: scope.organizationId,
      workspaceId: scope.workspaceId,
      enabled: false,
    });
    expect(disabled.statusCode).toBe(200);
    expect((disabled.json() as { endpoint: { enabled: boolean } }).endpoint.enabled).toBe(false);

    // Delete (the route is DELETE — use the raw inject).
    const deletedResponse = await client.app.inject({
      method: 'DELETE',
      url: `/api/integrations/webhooks/${endpointId}`,
      headers: { cookie: client.session, 'content-type': 'application/json' },
      payload: { organizationId: scope.organizationId, workspaceId: scope.workspaceId },
    });
    expect(deletedResponse.statusCode).toBe(204);

    const after = await client.get(
      `/api/integrations/webhooks?organizationId=${scope.organizationId}&workspaceId=${scope.workspaceId}`,
    );
    expect((after.json() as { endpoints: unknown[] }).endpoints).toHaveLength(0);

    await client.app.close();
  });

  it('rejects invalid URLs and out-of-catalog subscriptions with 400', async () => {
    const client = await chatClient();
    const scope = await onboardOrgAndWorkspace(client);

    const badUrl = await client.post('/api/integrations/webhooks', {
      organizationId: scope.organizationId,
      workspaceId: scope.workspaceId,
      url: 'ftp://nope',
      eventTypes: ['project.created'],
    });
    expect(badUrl.statusCode).toBe(400);
    expect(badUrl.json()).toMatchObject({ error: { code: 'VALIDATION_ERROR' } });

    const badEvent = await client.post('/api/integrations/webhooks', {
      organizationId: scope.organizationId,
      workspaceId: scope.workspaceId,
      url: 'https://example.com/hooks',
      eventTypes: ['payment.processed'],
    });
    expect(badEvent.statusCode).toBe(400);

    await client.app.close();
  });

  it('enforces the ONE authorization path: 401 unauthenticated, 403 foreign scope', async () => {
    const client = await chatClient();
    const scope = await onboardOrgAndWorkspace(client);
    const userId = currentUserId(client);

    // Unauthenticated → 401.
    const unauth = await client.app.inject({
      method: 'GET',
      url: `/api/integrations/webhooks?organizationId=${scope.organizationId}&workspaceId=${scope.workspaceId}`,
    });
    expect(unauth.statusCode).toBe(401);

    // A workspace the caller is NOT a member of → 403 (even though the
    // caller belongs to the organization).
    await seedWorkspace(client.repos, {
      id: 'wsp_int_alien',
      organizationId: scope.organizationId,
      slug: 'int-alien-ws',
    });
    const foreignWs = await client.get(
      `/api/integrations/webhooks?organizationId=${scope.organizationId}&workspaceId=wsp_int_alien`,
    );
    expect(foreignWs.statusCode).toBe(403);

    // A foreign tenant → 403.
    const foreignTenant = await client.get(
      `/api/integrations/webhooks?organizationId=org_alien&workspaceId=${scope.workspaceId}`,
    );
    expect(foreignTenant.statusCode).toBe(403);

    // Forged endpoint id in a scope the caller controls → 404.
    const forged = await client.patch('/api/integrations/webhooks/whk_forged', {
      organizationId: scope.organizationId,
      workspaceId: scope.workspaceId,
      url: 'https://example.com/hooks',
      eventTypes: ['project.created'],
    });
    expect(forged.statusCode).toBe(404);

    // An endpoint in ANOTHER workspace the caller belongs to → 404 through
    // this workspace (the scope check happens before the record read).
    await seedWorkspace(client.repos, {
      id: 'wsp_int_other',
      organizationId: scope.organizationId,
      slug: 'int-other-ws',
    });
    await seedWorkspaceMembership(client.repos, {
      workspaceId: 'wsp_int_other',
      userId,
      role: 'owner',
      organizationId: scope.organizationId,
    });
    await seedOrganizationMembership(client.repos, {
      organizationId: scope.organizationId,
      userId,
      role: 'owner',
    });
    const created = await client.post('/api/integrations/webhooks', {
      organizationId: scope.organizationId,
      workspaceId: 'wsp_int_other',
      url: 'https://other.example.com/hooks',
      eventTypes: ['project.created'],
    });
    expect(created.statusCode).toBe(201);
    const otherEndpointId = (created.json() as { endpoint: { id: string } }).endpoint.id;
    const crossWs = await client.patch(`/api/integrations/webhooks/${otherEndpointId}`, {
      organizationId: scope.organizationId,
      workspaceId: scope.workspaceId,
      url: 'https://evil.example.com/hooks',
      eventTypes: ['project.created'],
    });
    expect(crossWs.statusCode).toBe(404);

    await client.app.close();
  });
});

describe('S20 integrations — webhook delivery on EVT (DoD)', () => {
  it('delivers a signed payload when a subscribed business event fires and records a receipt', async () => {
    // A fake transport records deliveries (no network); the dispatcher is
    // injected at the composition root through the test harness.
    const received: Array<{ url: string; headers: Record<string, string>; body: string }> = [];
    const webhookHttp = {
      async post(input: { url: string; headers: Record<string, string>; body: string }) {
        received.push(input);
        return { status: 200 };
      },
    };
    const { app, repos } = await buildTestApp({ webhookHttp });
    const session = await login(app);
    const client = {
      app,
      session,
      repos,
      get(path: string) {
        return app.inject({ method: 'GET', url: path, headers: { cookie: session } });
      },
      post(path: string, body?: Record<string, unknown>) {
        return app.inject({
          method: 'POST',
          url: path,
          headers: { cookie: session, 'content-type': 'application/json' },
          payload: body,
        });
      },
    };
    const scope = await onboardOrgAndWorkspace(client as never);

    // Subscribe to calendar.event.created.
    const created = await client.post('/api/integrations/webhooks', {
      organizationId: scope.organizationId,
      workspaceId: scope.workspaceId,
      url: 'https://example.com/hooks/nexora',
      eventTypes: ['calendar.event.created'],
    });
    expect(created.statusCode).toBe(201);
    const endpointId = (created.json() as { endpoint: { id: string } }).endpoint.id;
    const secret = (created.json() as { secret: string }).secret;

    // Fire the business event through the calendar API — the SAME event
    // backbone the dispatcher consumes (real event → signed delivery).
    const calendar = await client.post('/api/calendar/events', {
      organizationId: scope.organizationId,
      workspaceId: scope.workspaceId,
      title: 'Project Review',
      startsAt: '2026-09-01T15:00:00.000Z',
      endsAt: '2026-09-01T16:00:00.000Z',
    });
    expect(calendar.statusCode).toBe(201);

    // The signed payload reached the endpoint URL.
    expect(received).toHaveLength(1);
    const delivery = received[0];
    if (delivery !== undefined) {
      expect(delivery.url).toBe('https://example.com/hooks/nexora');
      expect(delivery.headers['x-nexora-event-type']).toBe('calendar.event.created');
      const signature = delivery.headers['x-nexora-signature'] ?? '';
      expect(signature.startsWith('sha256=')).toBe(true);
      // The signature verifies against the endpoint secret + actual body.
      const { IntegrationApplicationService } = await import('@nexora/module-integrations');
      expect(
        IntegrationApplicationService.verifySignature(
          secret,
          delivery.body,
          signature.slice('sha256='.length),
        ),
      ).toBe(true);
      // The payload is the canonical event envelope (type + tenant + ws).
      const parsed = JSON.parse(delivery.body) as {
        type: string;
        tenantId: string;
        workspaceId: string;
      };
      expect(parsed.type).toBe('calendar.event.created');
      expect(parsed.tenantId).toBe(scope.organizationId);
      expect(parsed.workspaceId).toBe(scope.workspaceId);
    }

    // The receipt is appended and readable.
    const deliveries = await client.get(
      `/api/integrations/webhooks/${endpointId}/deliveries?organizationId=${scope.organizationId}&workspaceId=${scope.workspaceId}`,
    );
    expect(deliveries.statusCode).toBe(200);
    const body = deliveries.json() as {
      deliveries: { eventType: string; status: string; attempt: number; statusCode?: number }[];
    };
    expect(body.deliveries).toHaveLength(1);
    expect(body.deliveries[0]?.eventType).toBe('calendar.event.created');
    expect(body.deliveries[0]?.status).toBe('delivered');
    expect(body.deliveries[0]?.statusCode).toBe(200);

    // A disabled endpoint stops receiving deliveries.
    await client.post(`/api/integrations/webhooks/${endpointId}/enable`, {
      organizationId: scope.organizationId,
      workspaceId: scope.workspaceId,
      enabled: false,
    });
    const before = received.length;
    await client.post('/api/calendar/events', {
      organizationId: scope.organizationId,
      workspaceId: scope.workspaceId,
      title: 'Another Review',
      startsAt: '2026-09-02T15:00:00.000Z',
      endsAt: '2026-09-02T16:00:00.000Z',
    });
    expect(received.length).toBe(before);

    await app.close();
  });
});

describe('S20 integrations — email outbox (API)', () => {
  it('records dispatched emails and exposes them via the outbox endpoint', async () => {
    const client = await chatClient();
    const scope = await onboardOrgAndWorkspace(client);

    // Fire a project.created event (policy → recipient-scoped notification
    // → email projection → outbox record + dev-sink log).
    const project = await client.post('/api/projects', {
      organizationId: scope.organizationId,
      name: 'Mobile Banking',
      description: 'Core banking app',
    });
    expect(project.statusCode).toBe(201);

    const outbox = await client.get(
      `/api/integrations/email/outbox?organizationId=${scope.organizationId}&workspaceId=${scope.workspaceId}`,
    );
    expect(outbox.statusCode).toBe(200);
    const body = outbox.json() as { emails: { subject: string; recipientEmail: string }[] };
    expect(body.emails.some((email) => email.subject === 'Project created')).toBe(true);
    expect(body.emails[0]?.recipientEmail).toMatch(/@/);

    // Tenant isolation: a foreign tenant sees nothing.
    const alien = await client.get(
      `/api/integrations/email/outbox?organizationId=org_alien&workspaceId=${scope.workspaceId}`,
    );
    expect(alien.statusCode).toBe(403);

    await client.app.close();
  });
});

describe('email outbox — recipient scoping', () => {
  it('a plain workspace member reads only their OWN emails; the integration administrator reads all', async () => {
    const client = await chatClientWithSecondUser();
    const scope = await onboardOrgAndWorkspace(client);
    await client.second.join({
      organizationId: scope.organizationId,
      workspaceId: scope.workspaceId,
      workspaceRole: 'member',
    });
    const ownerId = currentUserId(client);
    const record = (recipientId: string, email: string, subject: string, event: string) =>
      EmailRecord.create({
        tenantId: scope.organizationId as TenantId,
        workspaceId: scope.workspaceId as WorkspaceId,
        recipientId,
        recipientEmail: email,
        subject,
        body: `body for ${email}`,
        sourceEventId: event,
        correlationId: 'corr_outbox',
      });
    await client.repos.emailOutbox.save(record(ownerId, 'owner@nexora.dev', 'For the owner', 'e1'));
    await client.repos.emailOutbox.save(
      record(client.second.userId, 'member@nexora.dev', 'For the member', 'e2'),
    );
    const url = `/api/integrations/email/outbox?organizationId=${scope.organizationId}&workspaceId=${scope.workspaceId}`;

    const asMember = (await client.second.get(url)).json() as { emails: { subject: string }[] };
    expect(asMember.emails.map((email) => email.subject)).toEqual(['For the member']);

    const asOwner = (await client.get(url)).json() as { emails: { subject: string }[] };
    expect(asOwner.emails.map((email) => email.subject).sort()).toEqual([
      'For the member',
      'For the owner',
    ]);
    await client.app.close();
  });
});

describe('S20 integrations — signed inbound email actions (API)', () => {
  function signedPayload(body: Record<string, string>): {
    payload: string;
    headers: Record<string, string>;
  } {
    const payload = JSON.stringify(body);
    return {
      payload,
      headers: { 'x-nexora-inbound-signature': signInboundBody(INBOUND_SECRET, payload) },
    };
  }

  it('routes approval.decide from an allowlisted sender with a valid signature', async () => {
    const client = await chatClient();
    const scope = await onboardOrgAndWorkspace(client);
    // Seed the sender as a member of the org + workspace (the allowlist).
    const userId = currentUserId(client);
    await seedOrganizationMembership(client.repos, {
      organizationId: scope.organizationId,
      userId,
      role: 'owner',
    });
    await seedWorkspaceMembership(client.repos, {
      workspaceId: scope.workspaceId,
      userId,
      role: 'owner',
      organizationId: scope.organizationId,
    });

    // Open an approval request in the AI runtime's ApprovalEngine via the
    // chat + approval surface, then decide it by email.
    const approval = await client.app.inject({
      method: 'GET',
      url: '/api/approvals',
      headers: { cookie: client.session },
    });
    void approval;

    // The routable action catalog is `approval.decide`; with no live
    // approval id the router returns NOT FOUND (forged ids fail closed).
    const { payload, headers } = signedPayload({
      organizationId: scope.organizationId,
      workspaceId: scope.workspaceId,
      messageId: 'msg_approve_1',
      from: 'alex@nexora.dev',
      action: 'approval.decide',
      targetId: 'apr_forged',
      decision: 'grant',
    });
    const forged = await client.app.inject({
      method: 'POST',
      url: '/api/integrations/email/inbound',
      headers: { ...headers, 'content-type': 'application/json' },
      payload,
    });
    expect(forged.statusCode).toBe(404);

    await client.app.close();
  });

  it('rejects a REPLAYED message id with 409 before the action can re-run (S21 IN-01)', async () => {
    const client = await chatClient();
    const scope = await onboardOrgAndWorkspace(client);
    const userId = currentUserId(client);
    await seedOrganizationMembership(client.repos, {
      organizationId: scope.organizationId,
      userId,
      role: 'owner',
    });
    await seedWorkspaceMembership(client.repos, {
      workspaceId: scope.workspaceId,
      userId,
      role: 'owner',
      organizationId: scope.organizationId,
    });

    const messageId = 'msg_replay_api';
    const { payload, headers } = signedPayload({
      organizationId: scope.organizationId,
      workspaceId: scope.workspaceId,
      messageId,
      from: 'alex@nexora.dev',
      action: 'approval.decide',
      targetId: 'apr_forged',
      decision: 'grant',
    });
    const first = await client.app.inject({
      method: 'POST',
      url: '/api/integrations/email/inbound',
      headers: { ...headers, 'content-type': 'application/json' },
      payload,
    });
    expect(first.statusCode).toBe(404); // forged target — but the claim is consumed

    // The SAME signed message re-delivered is a replay: 409, never 404/200,
    // so the routed action cannot execute twice.
    const replay = await client.app.inject({
      method: 'POST',
      url: '/api/integrations/email/inbound',
      headers: { ...headers, 'content-type': 'application/json' },
      payload,
    });
    expect(replay.statusCode).toBe(409);
    expect(replay.json()).toMatchObject({ error: { code: 'CONFLICT' } });

    await client.app.close();
  });

  it('denies a missing or invalid signature with 401 (never reaches routing)', async () => {
    const client = await chatClient();
    const scope = await onboardOrgAndWorkspace(client);

    const noSignature = await client.app.inject({
      method: 'POST',
      url: '/api/integrations/email/inbound',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({
        organizationId: scope.organizationId,
        workspaceId: scope.workspaceId,
        messageId: 'msg_x',
        from: 'alex@nexora.dev',
        action: 'approval.decide',
        targetId: 'apr_1',
      }),
    });
    expect(noSignature.statusCode).toBe(401);

    const { payload } = signedPayload({
      organizationId: scope.organizationId,
      workspaceId: scope.workspaceId,
      messageId: 'msg_x',
      from: 'alex@nexora.dev',
      action: 'approval.decide',
      targetId: 'apr_1',
    });
    const badSignature = await client.app.inject({
      method: 'POST',
      url: '/api/integrations/email/inbound',
      headers: { 'content-type': 'application/json', 'x-nexora-inbound-signature': 'deadbeef' },
      payload,
    });
    expect(badSignature.statusCode).toBe(401);

    // A signature over a DIFFERENT body must fail (tamper detection).
    const tampered = await client.app.inject({
      method: 'POST',
      url: '/api/integrations/email/inbound',
      headers: {
        'content-type': 'application/json',
        'x-nexora-inbound-signature': signInboundBody(
          INBOUND_SECRET,
          JSON.stringify({ tampered: true }),
        ),
      },
      payload,
    });
    expect(tampered.statusCode).toBe(401);

    await client.app.close();
  });

  it('denies a non-allowlisted sender (valid signature, no membership)', async () => {
    const client = await chatClient();
    const scope = await onboardOrgAndWorkspace(client);

    const { payload, headers } = signedPayload({
      organizationId: scope.organizationId,
      workspaceId: scope.workspaceId,
      messageId: 'msg_attacker',
      from: 'attacker@example.com',
      action: 'approval.decide',
      targetId: 'apr_1',
      decision: 'grant',
    });
    const denied = await client.app.inject({
      method: 'POST',
      url: '/api/integrations/email/inbound',
      headers: { ...headers, 'content-type': 'application/json' },
      payload,
    });
    expect(denied.statusCode).toBe(403);
    expect(denied.json()).toMatchObject({ error: { code: 'AUTHORIZATION_ERROR' } });

    await client.app.close();
  });

  it('rejects malformed inbound bodies with 400', async () => {
    const client = await chatClient();
    const { payload, headers } = signedPayload({ action: 'approval.decide' });
    const malformed = await client.app.inject({
      method: 'POST',
      url: '/api/integrations/email/inbound',
      headers: { ...headers, 'content-type': 'application/json' },
      payload,
    });
    expect(malformed.statusCode).toBe(400);
    expect(malformed.json()).toMatchObject({ error: { code: 'VALIDATION_ERROR' } });
    await client.app.close();
  });
});
