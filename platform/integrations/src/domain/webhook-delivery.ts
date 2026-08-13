/**
 * @nexora/module-integrations — WebhookDelivery aggregate.
 *
 * A delivery receipt (SAD §5.x, API_CONTRACTS.md "delivery receipts"): one
 * row per business event delivered to a webhook endpoint, recording the
 * attempt count, the last HTTP status, and the terminal outcome. Receipts
 * are append-only — they are the audit trail of the webhook-out surface and
 * are never mutated after creation.
 */

import { prefixedId } from '@nexora/shared/ids';
import { nowIso } from '@nexora/shared/time';
import type { TenantId, WorkspaceId } from '@nexora/contracts/common';

/** The terminal outcome of a delivery attempt sequence. */
export type WebhookDeliveryStatus = 'delivered' | 'failed';

/** Input for creating a {@link WebhookDelivery}. */
export interface CreateWebhookDeliveryInput {
  /** The owning organization (tenant) id. */
  organizationId: TenantId;
  /** The owning workspace id. */
  workspaceId: WorkspaceId;
  /** The webhook endpoint that received (or was supposed to receive) it. */
  endpointId: string;
  /** The business event that triggered the delivery. */
  eventId: string;
  /** The business event type. */
  eventType: string;
  /** The terminal outcome. */
  status: WebhookDeliveryStatus;
  /** The final attempt number. */
  attempt: number;
  /** The HTTP status received on the final attempt (delivered only). */
  statusCode?: number;
  /** A human-readable failure reason (failed only). */
  error?: string;
}

/** A persistence snapshot of the {@link WebhookDelivery} aggregate. */
export interface WebhookDeliverySnapshot {
  /** The delivery receipt id. */
  id: string;
  /** The owning organization (tenant) id. */
  organizationId: TenantId;
  /** The owning workspace id. */
  workspaceId: WorkspaceId;
  /** The webhook endpoint id. */
  endpointId: string;
  /** The business event id that triggered the delivery. */
  eventId: string;
  /** The business event type. */
  eventType: string;
  /** The terminal outcome. */
  status: WebhookDeliveryStatus;
  /** The final attempt number. */
  attempt: number;
  /** The HTTP status received on the final attempt (delivered only). */
  statusCode?: number;
  /** A human-readable failure reason (failed only). */
  error?: string;
  /** ISO-8601 UTC delivery time. */
  deliveredAt: string;
}

/**
 * The {@link WebhookDelivery} aggregate root — an append-only receipt.
 */
export class WebhookDelivery {
  #id: string;
  readonly #organizationId: TenantId;
  readonly #workspaceId: WorkspaceId;
  readonly #endpointId: string;
  readonly #eventId: string;
  readonly #eventType: string;
  readonly #status: WebhookDeliveryStatus;
  readonly #attempt: number;
  readonly #statusCode?: number;
  readonly #error?: string;
  readonly #deliveredAt: string;

  private constructor(input: CreateWebhookDeliveryInput, deliveredAt: string) {
    this.#id = prefixedId('whd') as string;
    this.#organizationId = input.organizationId;
    this.#workspaceId = input.workspaceId;
    this.#endpointId = input.endpointId;
    this.#eventId = input.eventId;
    this.#eventType = input.eventType;
    this.#status = input.status;
    this.#attempt = input.attempt;
    this.#statusCode = input.statusCode;
    this.#error = input.error;
    this.#deliveredAt = deliveredAt;
  }

  /** Creates a new delivery receipt (append-only). */
  static create(input: CreateWebhookDeliveryInput, deliveredAt = nowIso()): WebhookDelivery {
    return new WebhookDelivery(input, deliveredAt);
  }

  /** The delivery receipt id. */
  get id(): string {
    return this.#id;
  }

  /** The owning organization (tenant) id. */
  get organizationId(): TenantId {
    return this.#organizationId;
  }

  /** The owning workspace id. */
  get workspaceId(): WorkspaceId {
    return this.#workspaceId;
  }

  /** The webhook endpoint id. */
  get endpointId(): string {
    return this.#endpointId;
  }

  /** The business event id that triggered the delivery. */
  get eventId(): string {
    return this.#eventId;
  }

  /** The business event type. */
  get eventType(): string {
    return this.#eventType;
  }

  /** The terminal outcome. */
  get status(): WebhookDeliveryStatus {
    return this.#status;
  }

  /** The final attempt number. */
  get attempt(): number {
    return this.#attempt;
  }

  /** The HTTP status received on the final attempt (delivered only). */
  get statusCode(): number | undefined {
    return this.#statusCode;
  }

  /** A human-readable failure reason (failed only). */
  get error(): string | undefined {
    return this.#error;
  }

  /** ISO-8601 UTC delivery time. */
  get deliveredAt(): string {
    return this.#deliveredAt;
  }

  /** Produces a persistence snapshot of the receipt. */
  static snapshot(delivery: WebhookDelivery): WebhookDeliverySnapshot {
    return {
      id: delivery.id,
      organizationId: delivery.organizationId,
      workspaceId: delivery.workspaceId,
      endpointId: delivery.endpointId,
      eventId: delivery.eventId,
      eventType: delivery.eventType,
      status: delivery.status,
      attempt: delivery.attempt,
      statusCode: delivery.statusCode,
      error: delivery.error,
      deliveredAt: delivery.deliveredAt,
    };
  }

  /** Reconstructs a receipt from a persistence snapshot (append-only). */
  static hydrate(snapshot: WebhookDeliverySnapshot): WebhookDelivery {
    const delivery = new WebhookDelivery(snapshot, snapshot.deliveredAt);
    // Reconstitution restores the persisted id (never regenerates one).
    delivery.#id = snapshot.id;
    return delivery;
  }
}
