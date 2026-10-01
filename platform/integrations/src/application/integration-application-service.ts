/**
 * @nexora/module-integrations — IntegrationApplicationService.
 *
 * The application layer orchestrator of the integration surface: the
 * workspace webhook registry (create/list/update/delete), the email outbox
 * read, and inbound email action routing. All invariants live in the
 * domain; this layer coordinates repositories, generates secrets, and
 * publishes the canonical events (BKD §9.3: the audit trail is events).
 */

import { createHmac, randomBytes } from 'node:crypto';

import type { Result } from '@nexora/shared/result';
import { err, ok } from '@nexora/shared/result';
import type { EventPublisher, EventEnvelope } from '@nexora/shared/events';
import type { TenantId, WorkspaceId } from '@nexora/contracts/common';
import { NotFoundError, type NexoraError } from '@nexora/shared/errors';

import { EmailRecord } from '../domain/email-record.js';
import type { WebhookDelivery } from '../domain/webhook-delivery.js';
import { WebhookEndpoint, WEBHOOK_SUBSCRIBABLE_EVENTS } from '../domain/webhook-endpoint.js';
import type { IntegrationEventContext } from '../events/index.js';
import {
  emailDispatchedEvent,
  inboundEmailActionEvent,
  webhookDeletedEvent,
} from '../events/index.js';
import { nowIso } from '@nexora/shared/time';

import type { EmailSender } from '../email/email-sender.js';
import { isInternalHostLiteral } from '../dispatch/destination-guard.js';
import {
  DuplicateInboundMessageError,
  InboundSenderNotAllowedError,
  InvalidWebhookUrlError,
  UnsubscribableEventError,
  WebhookEndpointNotFoundError,
} from '../errors/index.js';
import type {
  EmailOutboxRepository,
  InboundMessageRepository,
  WebhookDeliveryRepository,
  WebhookEndpointRepository,
} from '../repositories/integration-repository.js';

/** A URL input (http/https only). */
export interface WebhookUrlInput {
  url: string;
  eventTypes: readonly string[];
}

/** The outcome of an inbound email action routed by the application layer. */
export interface InboundEmailRouting {
  /** The routed action type (e.g. `approval.decide`). */
  action: string;
  /** The external message id (dedupe key). */
  messageId: string;
  /** The workspace scope. */
  workspaceId: WorkspaceId;
  /** The events emitted while routing (audit trail). */
  events: readonly EventEnvelope[];
}

/** Dependencies of the {@link IntegrationApplicationService}. */
export interface IntegrationApplicationServiceDependencies {
  /** Webhook endpoint persistence. */
  endpoints: WebhookEndpointRepository;
  /** Delivery receipt persistence. */
  deliveries: WebhookDeliveryRepository;
  /** Email outbox persistence. */
  emailOutbox: EmailOutboxRepository;
  /** The outbound email transport adapter. */
  emailSender: EmailSender;
  /**
   * The inbound sender allowlist (workspace-scoped trusted addresses).
   * Implemented at the composition root (workspace settings/identity read)
   * so the integration module never owns identity state.
   */
  isSenderAllowed: (input: {
    tenantId: TenantId;
    workspaceId: WorkspaceId;
    from: string;
  }) => Promise<boolean>;
  /**
   * The exactly-once claim ledger of the signed inbound endpoint: the
   * first delivery of an external message id wins; a replay is rejected
   * before any action executes (S21 finding IN-01).
   */
  inboundMessages: InboundMessageRepository;
  /**
   * Routes an inbound email action to the governing execution path (e.g.
   * the ApprovalEngine). Returns `false` when the target cannot be
   * resolved. Implemented at the composition root so the integration
   * module never reaches into the workflow/AI modules. `decision` is the
   * optional action parameter (e.g. `grant` | `reject` for approval
   * decisions); `from` is the verified sender address.
   */
  routeInboundAction: (input: {
    action: string;
    targetId: string;
    actorId: string;
    from: string;
    decision?: string;
    correlationId: string;
    tenantId: TenantId;
    workspaceId: WorkspaceId;
  }) => Promise<{ ok: boolean; reason?: string }>;
  /** Publishes domain events to the canonical event stream. */
  publisher: EventPublisher;
}

/**
 * The integration application service. All methods return a `Result` so
 * expected failures are explicit values.
 */
export class IntegrationApplicationService {
  readonly #endpoints: WebhookEndpointRepository;
  readonly #deliveries: WebhookDeliveryRepository;
  readonly #emailOutbox: EmailOutboxRepository;
  readonly #emailSender: EmailSender;
  readonly #isSenderAllowed: IntegrationApplicationServiceDependencies['isSenderAllowed'];
  readonly #inboundMessages: InboundMessageRepository;
  readonly #routeInboundAction: IntegrationApplicationServiceDependencies['routeInboundAction'];
  readonly #publisher: EventPublisher;

  constructor(dependencies: IntegrationApplicationServiceDependencies) {
    this.#endpoints = dependencies.endpoints;
    this.#deliveries = dependencies.deliveries;
    this.#emailOutbox = dependencies.emailOutbox;
    this.#emailSender = dependencies.emailSender;
    this.#isSenderAllowed = dependencies.isSenderAllowed;
    this.#inboundMessages = dependencies.inboundMessages;
    this.#routeInboundAction = dependencies.routeInboundAction;
    this.#publisher = dependencies.publisher;
  }

  /**
   * Creates a webhook endpoint: validates the URL and subscription against
   * the allowlist, generates the signing secret (exposed exactly once), and
   * publishes `integration.webhook.created`. Returns the secret in the
   * result — reads never surface it.
   */
  async createWebhookEndpoint(input: {
    organizationId: TenantId;
    workspaceId: WorkspaceId;
    url: string;
    eventTypes: readonly string[];
    actorId: string;
    correlationId: string;
  }): Promise<Result<{ endpoint: WebhookEndpoint; secret: string }, NexoraError>> {
    const validation = validateWebhookInput(input.url, input.eventTypes);
    if (validation !== undefined) {
      return err(validation);
    }
    const secret = randomBytes(32).toString('hex');
    const context: IntegrationEventContext = {
      actor: { kind: 'user', id: input.actorId },
      correlationId: input.correlationId,
      organizationId: input.organizationId,
    };
    const endpoint = WebhookEndpoint.create(
      {
        organizationId: input.organizationId,
        workspaceId: input.workspaceId,
        url: input.url,
        eventTypes: input.eventTypes,
      },
      secret,
      context,
    );
    await this.#endpoints.save(endpoint);
    const events = endpoint.pullDomainEvents();
    await this.#publisher.publish(events);
    return ok({ endpoint, secret });
  }

  /**
   * Lists the endpoints of a workspace (tenant-scoped). Secrets are never
   * included — callers map with the DTO layer which masks them.
   */
  async listWebhookEndpoints(
    tenantId: TenantId,
    workspaceId: WorkspaceId,
  ): Promise<readonly WebhookEndpoint[]> {
    return this.#endpoints.listByWorkspace(tenantId, workspaceId);
  }

  /**
   * Updates a webhook endpoint (URL + subscription). Rejects unknown ids
   * and out-of-catalog event types.
   */
  async updateWebhookEndpoint(input: {
    organizationId: TenantId;
    workspaceId: WorkspaceId;
    endpointId: string;
    url: string;
    eventTypes: readonly string[];
    actorId: string;
    correlationId: string;
  }): Promise<Result<WebhookEndpoint, NexoraError>> {
    const endpoint = await this.#endpoints.findByIdAndTenant(
      input.endpointId,
      input.organizationId,
    );
    if (endpoint === undefined || endpoint.workspaceId !== input.workspaceId) {
      return err(new WebhookEndpointNotFoundError({ endpointId: input.endpointId }));
    }
    const validation = validateWebhookInput(input.url, input.eventTypes);
    if (validation !== undefined) {
      return err(validation);
    }
    const context: IntegrationEventContext = {
      actor: { kind: 'user', id: input.actorId },
      correlationId: input.correlationId,
      organizationId: input.organizationId,
    };
    endpoint.update({ url: input.url, eventTypes: input.eventTypes }, context);
    await this.#endpoints.save(endpoint);
    await this.#publisher.publish(endpoint.pullDomainEvents());
    return ok(endpoint);
  }

  /**
   * Enables or disables a webhook endpoint. Disabling stops deliveries but
   * keeps the record (re-enabling is normal). A no-op toggle (already in
   * the requested state) persists nothing and emits nothing.
   */
  async setWebhookEndpointEnabled(input: {
    organizationId: TenantId;
    workspaceId: WorkspaceId;
    endpointId: string;
    enabled: boolean;
    actorId: string;
    correlationId: string;
  }): Promise<Result<WebhookEndpoint, NexoraError>> {
    const endpoint = await this.#endpoints.findByIdAndTenant(
      input.endpointId,
      input.organizationId,
    );
    if (endpoint === undefined || endpoint.workspaceId !== input.workspaceId) {
      return err(new WebhookEndpointNotFoundError({ endpointId: input.endpointId }));
    }
    const context: IntegrationEventContext = {
      actor: { kind: 'user', id: input.actorId },
      correlationId: input.correlationId,
      organizationId: input.organizationId,
    };
    endpoint.setEnabled(input.enabled, context);
    const events = endpoint.pullDomainEvents();
    if (events.length > 0) {
      await this.#endpoints.save(endpoint);
      await this.#publisher.publish(events);
    }
    return ok(endpoint);
  }

  /**
   * Deletes a webhook endpoint and publishes `integration.webhook.deleted`.
   */
  async deleteWebhookEndpoint(input: {
    organizationId: TenantId;
    workspaceId: WorkspaceId;
    endpointId: string;
    actorId: string;
    correlationId: string;
  }): Promise<Result<WebhookEndpoint, NexoraError>> {
    const endpoint = await this.#endpoints.findByIdAndTenant(
      input.endpointId,
      input.organizationId,
    );
    if (endpoint === undefined || endpoint.workspaceId !== input.workspaceId) {
      return err(new WebhookEndpointNotFoundError({ endpointId: input.endpointId }));
    }
    const context: IntegrationEventContext = {
      actor: { kind: 'user', id: input.actorId },
      correlationId: input.correlationId,
      organizationId: input.organizationId,
    };
    const snapshot = WebhookEndpoint.snapshot(endpoint);
    const event = webhookDeletedEvent(context, {
      endpointId: snapshot.id,
      workspaceId: snapshot.workspaceId,
      eventTypes: snapshot.eventTypes,
      enabled: snapshot.enabled,
    });
    await this.#endpoints.remove(endpoint);
    await this.#publisher.publish([event]);
    return ok(endpoint);
  }

  /**
   * Lists the delivery receipts of an endpoint. The endpoint must belong
   * to the caller's workspace — a foreign or cross-workspace endpoint id
   * resolves to NOT FOUND, never to another workspace's receipts (S21
   * finding IN-03: the receipts read was previously tenant-scoped only).
   */
  async listWebhookDeliveries(
    tenantId: TenantId,
    endpointId: string,
    options: { workspaceId: WorkspaceId; limit?: number },
  ): Promise<Result<readonly WebhookDelivery[], NexoraError>> {
    const endpoint = await this.#endpoints.findByIdAndTenant(endpointId, tenantId);
    if (endpoint === undefined || endpoint.workspaceId !== options.workspaceId) {
      return err(new WebhookEndpointNotFoundError({ endpointId }));
    }
    return ok(await this.#deliveries.listByEndpoint(tenantId, endpointId, options));
  }

  /** Lists the email outbox of a tenant (newest first). */
  async listEmailOutbox(
    tenantId: TenantId,
    options?: { workspaceId?: WorkspaceId; limit?: number },
  ): Promise<readonly EmailRecord[]> {
    return this.#emailOutbox.listByTenant(tenantId, options);
  }

  /**
   * Records and dispatches an email notification (called by the email
   * projection on the event seam). Idempotent on the source event — a
   * duplicate delivery never creates a second outbox record.
   */
  async dispatchEmail(input: {
    tenantId: TenantId;
    workspaceId?: WorkspaceId;
    recipientId: string;
    recipientEmail: string;
    subject: string;
    body: string;
    sourceEventId: string;
    correlationId: string;
  }): Promise<void> {
    const existing = await this.#emailOutbox.findBySourceEventId(
      input.sourceEventId,
      input.tenantId,
    );
    if (existing !== undefined) {
      return;
    }
    const record = EmailRecord.create({
      tenantId: input.tenantId,
      workspaceId: input.workspaceId,
      recipientId: input.recipientId,
      recipientEmail: input.recipientEmail,
      subject: input.subject,
      body: input.body,
      sourceEventId: input.sourceEventId,
      correlationId: input.correlationId,
    });
    await this.#emailOutbox.save(record);
    // The outbox row is persisted BEFORE the transport call — a transport
    // failure never loses the record.
    await this.#emailSender.send(record);
    const context: IntegrationEventContext = {
      actor: { kind: 'system', id: 'integration-email' },
      correlationId: input.correlationId,
      organizationId: input.tenantId,
    };
    await this.#publisher.publish([
      emailDispatchedEvent(context, {
        emailId: record.id,
        recipientId: record.recipientId,
        subject: record.subject,
        workspaceId: record.workspaceId,
      }),
    ]);
  }

  /**
   * Routes an inbound email action (V1-9 "inbound email actions"):
   * verifies the sender is allowlisted for the workspace, dedupes by the
   * external message id, then delegates the action to the governing
   * execution path (e.g. the ApprovalEngine). The audit event is emitted
   * ONLY after the action routed successfully.
   */
  async routeInboundEmail(input: {
    tenantId: TenantId;
    workspaceId: WorkspaceId;
    messageId: string;
    from: string;
    action: string;
    targetId: string;
    decision?: string;
    actorId: string;
    correlationId: string;
  }): Promise<Result<InboundEmailRouting, NexoraError>> {
    // Allowlist: inbound senders are workspace-scoped trusted addresses
    // (the composition root resolves them from workspace settings/identity
    // — never from the request). A non-allowlisted sender is a hard deny.
    const allowed = await this.#isSenderAllowed({
      tenantId: input.tenantId,
      workspaceId: input.workspaceId,
      from: input.from,
    });
    if (!allowed) {
      return err(new InboundSenderNotAllowedError({ from: input.from }));
    }
    // Exactly-once claim (S21 finding IN-01): the external message id is
    // claimed atomically BEFORE the action routes. A replayed delivery of
    // the same message id fails the claim and is rejected — the action
    // never executes twice and no duplicate audit event is emitted.
    const claimed = await this.#inboundMessages.claim({
      tenantId: input.tenantId,
      workspaceId: input.workspaceId,
      messageId: input.messageId,
      action: input.action,
      targetId: input.targetId,
      handledAt: nowIso(),
    });
    if (!claimed) {
      return err(new DuplicateInboundMessageError({ messageId: input.messageId }));
    }
    const routed = await this.#routeInboundAction({
      action: input.action,
      targetId: input.targetId,
      actorId: input.actorId,
      from: input.from,
      decision: input.decision,
      correlationId: input.correlationId,
      tenantId: input.tenantId,
      workspaceId: input.workspaceId,
    });
    if (!routed.ok) {
      return err(
        new NotFoundError(
          `Inbound email action "${input.action}" target "${input.targetId}" was not found`,
        ),
      );
    }
    const context: IntegrationEventContext = {
      actor: { kind: 'user', id: input.actorId },
      correlationId: input.correlationId,
      organizationId: input.tenantId,
    };
    const event = inboundEmailActionEvent(context, {
      action: input.action,
      messageId: input.messageId,
      from: input.from,
      targetId: input.targetId,
      workspaceId: input.workspaceId,
    });
    await this.#publisher.publish([event]);
    return ok({
      action: input.action,
      messageId: input.messageId,
      workspaceId: input.workspaceId,
      events: [event],
    });
  }

  /** The subscribable event catalog (exposed to the API/UI). */
  static subscribableEvents(): readonly string[] {
    return [...WEBHOOK_SUBSCRIBABLE_EVENTS];
  }

  /**
   * Builds the canonical signature header value for a payload
   * (HMAC-SHA256 — S21 finding IN-02: the previous plain concatenation
   * hash was replaced with the standard keyed construction).
   */
  static sign(secret: string, body: string): string {
    return createHmac('sha256', secret).update(body).digest('hex');
  }

  /** Whether a signature matches (constant-time-ish comparison). */
  static verifySignature(secret: string, body: string, signature: string): boolean {
    const expected = IntegrationApplicationService.sign(secret, body);
    const actual = String(signature);
    if (expected.length !== actual.length) {
      return false;
    }
    let diff = 0;
    for (let i = 0; i < expected.length; i += 1) {
      diff |= expected.charCodeAt(i) ^ actual.charCodeAt(i);
    }
    return diff === 0;
  }
}

/** Validates a webhook input (URL + subscription allowlist). */
function validateWebhookInput(url: string, eventTypes: readonly string[]): NexoraError | undefined {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return new InvalidWebhookUrlError({ url });
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return new InvalidWebhookUrlError({ url });
  }
  // SSRF: an internal literal host (loopback, private, link-local, localhost)
  // is never a valid destination. Resolution-time checks at delivery cover
  // hostnames that merely point at internal addresses.
  if (isInternalHostLiteral(parsed)) {
    return new InvalidWebhookUrlError({ url });
  }
  const unknown = eventTypes.filter((type) => !WEBHOOK_SUBSCRIBABLE_EVENTS.includes(type));
  if (unknown.length > 0) {
    return new UnsubscribableEventError({ eventTypes: unknown });
  }
  return undefined;
}

export { WEBHOOK_SUBSCRIBABLE_EVENTS };
