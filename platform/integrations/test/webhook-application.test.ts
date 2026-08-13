/**
 * @nexora/module-integrations — application + dispatcher tests.
 *
 * The IntegrationApplicationService (webhook registry, email outbox
 * idempotency, inbound action routing) and the WebhookDispatcher (signed
 * delivery with retries + receipts, exactly-once receipts, never throws).
 * All persistence is in-memory fakes; the email sink is a recording fake.
 */

import { describe, expect, it } from 'vitest';

import type { EventEnvelope, EventPublisher } from '@nexora/shared/events';
import type { TenantId, WorkspaceId } from '@nexora/contracts/common';

import { IntegrationApplicationService } from '../src/application/integration-application-service.js';
import { WebhookDispatcher, type WebhookHttpClient } from '../src/dispatch/webhook-dispatcher.js';
import type { EmailRecord } from '../src/domain/email-record.js';
import type { WebhookDelivery } from '../src/domain/webhook-delivery.js';
import type { WebhookEndpoint } from '../src/domain/webhook-endpoint.js';
import type { EmailOutboxRepository } from '../src/repositories/integration-repository.js';

const TENANT = 'org_tenant_a' as TenantId;
const WORKSPACE = 'ws_a' as WorkspaceId;
const ACTOR = 'user_sarah';

/** A recording in-memory endpoint repository. */
class FakeEndpointRepository {
  readonly endpoints = new Map<string, WebhookEndpoint>();

  async findById(id: string): Promise<WebhookEndpoint | undefined> {
    return this.endpoints.get(id);
  }

  async findByIdAndTenant(id: string, tenantId: TenantId): Promise<WebhookEndpoint | undefined> {
    const endpoint = this.endpoints.get(id);
    return endpoint !== undefined && endpoint.organizationId === tenantId ? endpoint : undefined;
  }

  async listByWorkspace(
    tenantId: TenantId,
    workspaceId: WorkspaceId,
  ): Promise<readonly WebhookEndpoint[]> {
    return [...this.endpoints.values()].filter(
      (endpoint) => endpoint.organizationId === tenantId && endpoint.workspaceId === workspaceId,
    );
  }

  async listSubscribed(
    tenantId: TenantId,
    workspaceId: WorkspaceId,
    eventType: string,
  ): Promise<readonly WebhookEndpoint[]> {
    return [...this.endpoints.values()].filter(
      (endpoint) =>
        endpoint.organizationId === tenantId &&
        endpoint.workspaceId === workspaceId &&
        endpoint.subscribesTo(eventType),
    );
  }

  async save(endpoint: WebhookEndpoint): Promise<void> {
    this.endpoints.set(endpoint.id, endpoint);
  }

  async remove(endpoint: WebhookEndpoint): Promise<void> {
    this.endpoints.delete(endpoint.id);
  }
}

/** A recording in-memory delivery repository. */
class FakeDeliveryRepository {
  readonly deliveries = new Map<string, WebhookDelivery>();

  async findByIdAndTenant(id: string): Promise<WebhookDelivery | undefined> {
    return this.deliveries.get(id);
  }

  async listByEndpoint(
    tenantId: TenantId,
    endpointId: string,
    options?: { limit?: number },
  ): Promise<readonly WebhookDelivery[]> {
    return [...this.deliveries.values()]
      .filter(
        (delivery) => delivery.organizationId === tenantId && delivery.endpointId === endpointId,
      )
      .sort((a, b) => b.deliveredAt.localeCompare(a.deliveredAt))
      .slice(0, options?.limit ?? 100);
  }

  async save(delivery: WebhookDelivery): Promise<void> {
    this.deliveries.set(delivery.id, delivery);
  }
}

/** A recording in-memory email outbox. */
class FakeEmailOutbox implements EmailOutboxRepository {
  readonly records = new Map<string, EmailRecord>();

  async findByIdAndTenant(id: string, tenantId: TenantId): Promise<EmailRecord | undefined> {
    const record = this.records.get(id);
    return record !== undefined && record.tenantId === tenantId ? record : undefined;
  }

  async findBySourceEventId(
    sourceEventId: string,
    tenantId: TenantId,
  ): Promise<EmailRecord | undefined> {
    for (const record of this.records.values()) {
      if (record.sourceEventId === sourceEventId && record.tenantId === tenantId) {
        return record;
      }
    }
    return undefined;
  }

  async listByTenant(
    tenantId: TenantId,
    options?: { workspaceId?: WorkspaceId; limit?: number },
  ): Promise<readonly EmailRecord[]> {
    return [...this.records.values()]
      .filter((record) => {
        const scoped = record.tenantId === tenantId;
        if (options?.workspaceId !== undefined) {
          return scoped && record.workspaceId === options.workspaceId;
        }
        return scoped;
      })
      .sort((a, b) => b.dispatchedAt.localeCompare(a.dispatchedAt))
      .slice(0, options?.limit ?? 100);
  }

  async save(record: EmailRecord): Promise<void> {
    this.records.set(record.id, record);
  }
}

/** A recording publisher. */
class FakePublisher implements EventPublisher {
  readonly events: EventEnvelope[] = [];

  async publish(events: readonly EventEnvelope[]): Promise<void> {
    this.events.push(...events);
  }
}

/** A recording email sender. */
class FakeEmailSender {
  readonly sent: EmailRecord[] = [];

  async send(record: EmailRecord): Promise<void> {
    this.sent.push(record);
  }
}

function makeService(): {
  endpoints: FakeEndpointRepository;
  deliveries: FakeDeliveryRepository;
  emailOutbox: FakeEmailOutbox;
  emailSender: FakeEmailSender;
  publisher: FakePublisher;
  service: IntegrationApplicationService;
} {
  const endpoints = new FakeEndpointRepository();
  const deliveries = new FakeDeliveryRepository();
  const emailOutbox = new FakeEmailOutbox();
  const emailSender = new FakeEmailSender();
  const publisher = new FakePublisher();
  const service = new IntegrationApplicationService({
    endpoints,
    deliveries,
    emailOutbox,
    emailSender,
    isSenderAllowed: async ({ from }) => from === 'sarah@nexora.dev',
    routeInboundAction: async ({ action, targetId, decision }) => {
      if (action !== 'approval.decide') {
        return { ok: false, reason: 'unknown-action' };
      }
      if (targetId === 'apr_foreign' || decision === undefined) {
        return { ok: false, reason: 'target-not-found' };
      }
      return { ok: true };
    },
    publisher,
  });
  return { endpoints, deliveries, emailOutbox, emailSender, publisher, service };
}

describe('IntegrationApplicationService — webhook registry', () => {
  it('creates an endpoint, exposing the secret exactly once, and lists it', async () => {
    const { service, endpoints, publisher } = makeService();
    const result = await service.createWebhookEndpoint({
      organizationId: TENANT,
      workspaceId: WORKSPACE,
      url: 'https://example.com/hooks/nexora',
      eventTypes: ['project.created'],
      actorId: ACTOR,
      correlationId: 'corr_1',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.value.secret).toHaveLength(64);
    expect(result.value.endpoint.secret).toBe(result.value.secret);

    const listed = await service.listWebhookEndpoints(TENANT, WORKSPACE);
    expect(listed).toHaveLength(1);
    expect(listed[0]?.url).toBe('https://example.com/hooks/nexora');

    expect(publisher.events.map((event) => event.type)).toEqual(['integration.webhook.created']);
    expect(await endpoints.findByIdAndTenant(result.value.endpoint.id, TENANT)).toBeDefined();
  });

  it('rejects an invalid URL and out-of-catalog event types', async () => {
    const { service } = makeService();
    const badUrl = await service.createWebhookEndpoint({
      organizationId: TENANT,
      workspaceId: WORKSPACE,
      url: 'ftp://not-http',
      eventTypes: ['project.created'],
      actorId: ACTOR,
      correlationId: 'corr_2',
    });
    expect(badUrl.ok).toBe(false);
    if (badUrl.ok) {
      return;
    }
    expect(badUrl.error.code).toBe('VALIDATION_ERROR');

    const badEvent = await service.createWebhookEndpoint({
      organizationId: TENANT,
      workspaceId: WORKSPACE,
      url: 'https://example.com/hooks',
      eventTypes: ['payment.processed'],
      actorId: ACTOR,
      correlationId: 'corr_3',
    });
    expect(badEvent.ok).toBe(false);
    if (!badEvent.ok) {
      expect(badEvent.error.code).toBe('VALIDATION_ERROR');
    }
  });

  it('updates, toggles, and deletes endpoints (scoped to tenant + workspace)', async () => {
    const { service, endpoints, publisher } = makeService();
    const created = await service.createWebhookEndpoint({
      organizationId: TENANT,
      workspaceId: WORKSPACE,
      url: 'https://example.com/hooks',
      eventTypes: ['project.created'],
      actorId: ACTOR,
      correlationId: 'corr_4',
    });
    if (!created.ok) {
      return;
    }
    const endpointId = created.value.endpoint.id;
    publisher.events.length = 0;

    const updated = await service.updateWebhookEndpoint({
      organizationId: TENANT,
      workspaceId: WORKSPACE,
      endpointId,
      url: 'https://new.example.com/hooks',
      eventTypes: ['employee.created'],
      actorId: ACTOR,
      correlationId: 'corr_5',
    });
    expect(updated.ok).toBe(true);
    if (updated.ok) {
      expect(updated.value.url).toBe('https://new.example.com/hooks');
    }

    const toggled = await service.setWebhookEndpointEnabled({
      organizationId: TENANT,
      workspaceId: WORKSPACE,
      endpointId,
      enabled: false,
      actorId: ACTOR,
      correlationId: 'corr_6',
    });
    expect(toggled.ok).toBe(true);
    const after = await endpoints.findByIdAndTenant(endpointId, TENANT);
    expect(after?.enabled).toBe(false);

    // A foreign workspace cannot touch the endpoint.
    const foreign = await service.updateWebhookEndpoint({
      organizationId: TENANT,
      workspaceId: 'ws_other' as WorkspaceId,
      endpointId,
      url: 'https://evil.example.com/hooks',
      eventTypes: ['project.created'],
      actorId: ACTOR,
      correlationId: 'corr_7',
    });
    expect(foreign.ok).toBe(false);
    if (!foreign.ok) {
      expect(foreign.error.code).toBe('NOT_FOUND');
    }

    const deleted = await service.deleteWebhookEndpoint({
      organizationId: TENANT,
      workspaceId: WORKSPACE,
      endpointId,
      actorId: ACTOR,
      correlationId: 'corr_8',
    });
    expect(deleted.ok).toBe(true);
    expect(await endpoints.findById(endpointId)).toBeUndefined();
    expect(publisher.events.some((event) => event.type === 'integration.webhook.deleted')).toBe(
      true,
    );
  });
});

describe('IntegrationApplicationService — email outbox', () => {
  it('dispatches email idempotently on the source event (never double-sends)', async () => {
    const { service, emailOutbox, emailSender, publisher } = makeService();
    const input = {
      tenantId: TENANT,
      workspaceId: WORKSPACE,
      recipientId: ACTOR,
      recipientEmail: 'sarah@nexora.dev',
      subject: 'Project created',
      body: 'Project "Mobile Banking" was created.',
      sourceEventId: 'evt_1',
      correlationId: 'corr_1',
    };
    await service.dispatchEmail(input);
    await service.dispatchEmail(input); // duplicate delivery of the same event

    expect(emailOutbox.records.size).toBe(1);
    expect(emailSender.sent).toHaveLength(1);
    expect(
      publisher.events.filter((event) => event.type === 'integration.email.dispatched'),
    ).toHaveLength(1);

    const listed = await service.listEmailOutbox(TENANT, { workspaceId: WORKSPACE });
    expect(listed).toHaveLength(1);
    expect(listed[0]?.subject).toBe('Project created');
  });
});

describe('IntegrationApplicationService — inbound email actions', () => {
  it('routes an allowlisted sender action and emits the audit event', async () => {
    const { service, publisher } = makeService();
    const result = await service.routeInboundEmail({
      tenantId: TENANT,
      workspaceId: WORKSPACE,
      messageId: 'msg_1',
      from: 'sarah@nexora.dev',
      action: 'approval.decide',
      targetId: 'apr_1',
      decision: 'grant',
      actorId: ACTOR,
      correlationId: 'corr_1',
    });
    expect(result.ok).toBe(true);
    expect(publisher.events.map((event) => event.type)).toEqual(['integration.email.inbound']);
  });

  it('denies non-allowlisted senders with a hard POLICY error', async () => {
    const { service } = makeService();
    const result = await service.routeInboundEmail({
      tenantId: TENANT,
      workspaceId: WORKSPACE,
      messageId: 'msg_2',
      from: 'attacker@example.com',
      action: 'approval.decide',
      targetId: 'apr_1',
      decision: 'grant',
      actorId: 'attacker@example.com',
      correlationId: 'corr_2',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('AUTHORIZATION_ERROR');
    }
  });

  it('resolves an unroutable target to NOT FOUND (forged ids fail closed)', async () => {
    const { service } = makeService();
    const result = await service.routeInboundEmail({
      tenantId: TENANT,
      workspaceId: WORKSPACE,
      messageId: 'msg_3',
      from: 'sarah@nexora.dev',
      action: 'approval.decide',
      targetId: 'apr_foreign',
      decision: 'grant',
      actorId: ACTOR,
      correlationId: 'corr_3',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('NOT_FOUND');
    }
  });

  it('rejects actions outside the routable catalog', async () => {
    const { service } = makeService();
    const result = await service.routeInboundEmail({
      tenantId: TENANT,
      workspaceId: WORKSPACE,
      messageId: 'msg_4',
      from: 'sarah@nexora.dev',
      action: 'drop-table',
      targetId: 'x',
      actorId: ACTOR,
      correlationId: 'corr_4',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('NOT_FOUND');
    }
  });
});

describe('WebhookDispatcher', () => {
  function event(type: string, id: string): EventEnvelope {
    return {
      id,
      type,
      tenantId: TENANT,
      workspaceId: WORKSPACE,
      correlationId: `corr_${id}`,
      actor: { kind: 'user', id: ACTOR },
      payload: { name: 'Mobile Banking' },
      version: 1,
      occurredAt: new Date().toISOString(),
    };
  }

  it('delivers signed payloads to subscribed endpoints and records delivered receipts', async () => {
    const { service, endpoints, deliveries, publisher } = makeService();
    const created = await service.createWebhookEndpoint({
      organizationId: TENANT,
      workspaceId: WORKSPACE,
      url: 'https://example.com/hooks',
      eventTypes: ['project.created'],
      actorId: ACTOR,
      correlationId: 'corr_setup',
    });
    if (!created.ok) {
      return;
    }
    const secret = created.value.secret;

    const received: Array<{ url: string; headers: Record<string, string>; body: string }> = [];
    const http: WebhookHttpClient = {
      async post(input) {
        received.push(input);
        return { status: 200 };
      },
    };
    const dispatcher = new WebhookDispatcher({
      endpoints,
      deliveries,
      publisher,
      http,
      maxAttempts: 3,
    });

    await dispatcher.handle(event('project.created', 'evt_deliver'));

    expect(received).toHaveLength(1);
    const delivery = received[0];
    if (delivery === undefined) {
      return;
    }
    expect(delivery.url).toBe('https://example.com/hooks');
    expect(delivery.headers['x-nexora-event-id']).toBe('evt_deliver');
    expect(delivery.headers['x-nexora-event-type']).toBe('project.created');
    const signature = delivery.headers['x-nexora-signature'] ?? '';
    expect(signature.startsWith('sha256=')).toBe(true);
    // The signature is over the ACTUAL body with the endpoint secret.
    expect(
      IntegrationApplicationService.verifySignature(
        secret,
        delivery.body,
        signature.slice('sha256='.length),
      ),
    ).toBe(true);

    const receipts = [...deliveries.deliveries.values()];
    expect(receipts).toHaveLength(1);
    expect(receipts[0]?.status).toBe('delivered');
    expect(receipts[0]?.attempt).toBe(1);
    expect(receipts[0]?.statusCode).toBe(200);
    expect(publisher.events.some((e) => e.type === 'integration.webhook.delivered')).toBe(true);
  });

  it('retries transport failures and records a failed receipt when exhausted', async () => {
    const { service, endpoints, deliveries, publisher } = makeService();
    const created = await service.createWebhookEndpoint({
      organizationId: TENANT,
      workspaceId: WORKSPACE,
      url: 'https://down.example.com/hooks',
      eventTypes: ['employee.created'],
      actorId: ACTOR,
      correlationId: 'corr_setup2',
    });
    if (!created.ok) {
      return;
    }
    let calls = 0;
    const http: WebhookHttpClient = {
      async post() {
        calls += 1;
        throw new Error('ECONNREFUSED');
      },
    };
    const dispatcher = new WebhookDispatcher({
      endpoints,
      deliveries,
      publisher,
      http,
      maxAttempts: 3,
      backoffMs: 1,
    });

    await dispatcher.handle(event('employee.created', 'evt_fail'));

    expect(calls).toBe(3);
    const receipts = [...deliveries.deliveries.values()];
    expect(receipts).toHaveLength(1);
    expect(receipts[0]?.status).toBe('failed');
    expect(receipts[0]?.attempt).toBe(3);
    expect(receipts[0]?.error).toBe('ECONNREFUSED');
    expect(publisher.events.some((e) => e.type === 'integration.webhook.failed')).toBe(true);
  });

  it('retries on 5xx but not on 2xx, recording the final outcome', async () => {
    const { service, endpoints, deliveries } = makeService();
    const created = await service.createWebhookEndpoint({
      organizationId: TENANT,
      workspaceId: WORKSPACE,
      url: 'https://flaky.example.com/hooks',
      eventTypes: ['project.created'],
      actorId: ACTOR,
      correlationId: 'corr_setup3',
    });
    if (!created.ok) {
      return;
    }
    const statuses = [500, 503, 200];
    let call = 0;
    const http: WebhookHttpClient = {
      async post() {
        const status = statuses[call] ?? 200;
        call += 1;
        return { status };
      },
    };
    const dispatcher = new WebhookDispatcher({
      endpoints,
      deliveries,
      publisher: new FakePublisher(),
      http,
      maxAttempts: 3,
      backoffMs: 1,
    });

    await dispatcher.handle(event('project.created', 'evt_flaky'));

    expect(call).toBe(3);
    const receipts = [...deliveries.deliveries.values()];
    expect(receipts[0]?.status).toBe('delivered');
    expect(receipts[0]?.attempt).toBe(3);
    expect(receipts[0]?.statusCode).toBe(200);
  });

  it('never throws into the publisher (delivery failures are receipts, not exceptions)', async () => {
    const { endpoints, deliveries } = makeService();
    const http: WebhookHttpClient = {
      async post() {
        throw new Error('boom');
      },
    };
    const dispatcher = new WebhookDispatcher({
      endpoints,
      deliveries,
      publisher: new FakePublisher(),
      http,
      maxAttempts: 2,
      backoffMs: 1,
    });
    // No subscribed endpoints → nothing happens, no throw.
    await expect(dispatcher.handle(event('project.created', 'evt_none'))).resolves.toBeUndefined();
  });
});
