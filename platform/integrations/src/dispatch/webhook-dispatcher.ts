/**
 * @nexora/module-integrations — WebhookDispatcher.
 *
 * The webhook-out engine. Sits on the canonical event stream (the
 * EventPublisher seam — the same seam the Notification consumer uses): for
 * every business event it finds the workspace webhook endpoints subscribed
 * to that event type, delivers a signed HMAC-SHA256 payload, retries on
 * transport/5xx failures (bounded backoff), and appends a
 * {@link WebhookDelivery} receipt for every terminal outcome (SAD §5.x
 * delivery receipts, V1-9 "webhook fired on EVT").
 *
 * Security and reliability contract:
 * - The payload is the canonical event envelope — never augmented with data
 *   the trusted envelope does not carry (no cross-tenant leaks).
 * - The signature is `X-Nexora-Signature: sha256=hex(secret:body)`; the
 *   secret is the endpoint's HMAC key (never exposed on reads).
 * - Receipts are append-only and tenant-scoped in SQL.
 * - The dispatcher NEVER throws into the publisher: a delivery failure is
 *   recorded as a receipt and swallowed, so the business mutation that
 *   emitted the event is never broken by webhook delivery.
 */

import type { EventEnvelope, EventPublisher } from '@nexora/shared/events';
import type { TenantId, WorkspaceId } from '@nexora/contracts/common';

import { createGuardedWebhookHttpClient } from './destination-guard.js';
import { IntegrationApplicationService } from '../application/integration-application-service.js';
import { WebhookDelivery } from '../domain/webhook-delivery.js';
import type { WebhookEndpoint } from '../domain/webhook-endpoint.js';
import type { IntegrationEventContext } from '../events/index.js';
import { webhookDeliveredEvent, webhookFailedEvent } from '../events/index.js';
import type {
  WebhookDeliveryRepository,
  WebhookEndpointRepository,
} from '../repositories/integration-repository.js';

/** A minimal structured logger surface (satisfied by Fastify's logger). */
export interface WebhookDispatcherLogger {
  error(obj: Record<string, unknown>, message?: string): void;
}

/** The HTTP transport port (defaults to the SSRF-guarded transport). */
export interface WebhookHttpClient {
  post(input: { url: string; headers: Record<string, string>; body: string }): Promise<{
    status: number;
  }>;
}

/**
 * The default transport: SSRF-guarded (see `destination-guard.ts`) — public
 * destinations only, connection pinned to the validated address, redirect
 * hops re-validated.
 */
export const guardedWebhookHttpClient: WebhookHttpClient = createGuardedWebhookHttpClient();

/** Dependencies of the {@link WebhookDispatcher}. */
export interface WebhookDispatcherDependencies {
  /** Webhook endpoint persistence (subscribed-endpoint lookups). */
  endpoints: WebhookEndpointRepository;
  /** Delivery receipt persistence (append-only). */
  deliveries: WebhookDeliveryRepository;
  /** Publishes delivery outcome events (observability/audit). */
  publisher: EventPublisher;
  /** The HTTP transport (defaults to the SSRF-guarded transport). */
  http?: WebhookHttpClient;
  /** Retry budget: max attempts (default 3). */
  maxAttempts?: number;
  /** Backoff base in ms between attempts (default 250ms). */
  backoffMs?: number;
  /** An optional logger (failures never propagate to the publisher). */
  logger?: WebhookDispatcherLogger;
}

/**
 * Consumes the canonical business event stream and delivers signed webhook
 * payloads to subscribed endpoints. Attached to the EventPublisher seam at
 * the composition root — domains never call it directly.
 */
export class WebhookDispatcher {
  readonly #endpoints: WebhookEndpointRepository;
  readonly #deliveries: WebhookDeliveryRepository;
  readonly #publisher: EventPublisher;
  readonly #http: WebhookHttpClient;
  readonly #maxAttempts: number;
  readonly #backoffMs: number;
  readonly #logger?: WebhookDispatcherLogger;

  constructor(dependencies: WebhookDispatcherDependencies) {
    this.#endpoints = dependencies.endpoints;
    this.#deliveries = dependencies.deliveries;
    this.#publisher = dependencies.publisher;
    this.#http = dependencies.http ?? guardedWebhookHttpClient;
    this.#maxAttempts = dependencies.maxAttempts ?? 3;
    this.#backoffMs = dependencies.backoffMs ?? 250;
    this.#logger = dependencies.logger;
  }

  /**
   * Handles one event envelope: finds subscribed endpoints and delivers.
   * Never throws — every failure is recorded as a receipt and logged.
   */
  async handle(event: EventEnvelope): Promise<void> {
    const tenantId = event.tenantId as TenantId;
    const workspaceId = event.workspaceId as WorkspaceId | undefined;
    if (workspaceId === undefined) {
      return; // Webhooks are workspace-scoped; non-scoped events have no targets.
    }
    try {
      const endpoints = await this.#endpoints.listSubscribed(tenantId, workspaceId, event.type);
      if (endpoints.length === 0) {
        return;
      }
      await Promise.all(endpoints.map((endpoint) => this.#deliver(event, endpoint)));
    } catch (caught) {
      this.#logger?.error(
        { err: caught, eventId: event.id, eventType: event.type },
        'webhook dispatcher failed',
      );
    }
  }

  /** Delivers one event to one endpoint with retries + a terminal receipt. */
  async #deliver(event: EventEnvelope, endpoint: WebhookEndpoint): Promise<void> {
    const body = JSON.stringify(event);
    const signature = IntegrationApplicationService.sign(endpoint.secret, body);
    const headers = {
      'x-nexora-signature': `sha256=${signature}`,
      'x-nexora-event-id': event.id,
      'x-nexora-event-type': event.type,
    };

    let lastStatus: number | undefined;
    let lastError: string | undefined;
    for (let attempt = 1; attempt <= this.#maxAttempts; attempt += 1) {
      try {
        const response = await this.#http.post({
          url: endpoint.url,
          headers,
          body,
        });
        lastStatus = response.status;
        if (response.status >= 200 && response.status < 300) {
          await this.#recordReceipt(event, endpoint, {
            status: 'delivered',
            attempt,
            statusCode: response.status,
          });
          return;
        }
        lastError = `HTTP ${response.status}`;
      } catch (caught) {
        lastError = caught instanceof Error ? caught.message : String(caught);
      }
      if (attempt < this.#maxAttempts) {
        await sleep(this.#backoffMs * attempt);
      }
    }
    // Retries exhausted — record the failure receipt.
    await this.#recordReceipt(event, endpoint, {
      status: 'failed',
      attempt: this.#maxAttempts,
      statusCode: lastStatus,
      error: lastError,
    });
  }

  /** Appends a terminal receipt and emits the outcome event (audit). */
  async #recordReceipt(
    event: EventEnvelope,
    endpoint: WebhookEndpoint,
    input: {
      status: 'delivered' | 'failed';
      attempt: number;
      statusCode?: number;
      error?: string;
    },
  ): Promise<void> {
    const delivery = WebhookDelivery.create({
      organizationId: endpoint.organizationId,
      workspaceId: endpoint.workspaceId,
      endpointId: endpoint.id,
      eventId: event.id,
      eventType: event.type,
      status: input.status,
      attempt: input.attempt,
      statusCode: input.statusCode,
      error: input.error,
    });
    await this.#deliveries.save(delivery);

    const context: IntegrationEventContext = {
      actor: { kind: 'system', id: 'webhook-dispatcher' },
      correlationId: event.correlationId,
      organizationId: endpoint.organizationId,
    };
    const outcome =
      input.status === 'delivered'
        ? webhookDeliveredEvent(context, {
            endpointId: endpoint.id,
            workspaceId: endpoint.workspaceId,
            eventId: event.id,
            attempt: input.attempt,
            statusCode: input.statusCode,
          })
        : webhookFailedEvent(context, {
            endpointId: endpoint.id,
            workspaceId: endpoint.workspaceId,
            eventId: event.id,
            attempt: input.attempt,
            error: input.error,
          });
    await this.#publisher.publish([outcome]);
  }
}

/** A tiny sleep helper (no timer dependency). */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
