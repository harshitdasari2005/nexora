/**
 * @nexora/module-integrations — repository ports.
 *
 * The persistence seams of the integration surface: webhook endpoints,
 * delivery receipts, and the email outbox. Every read is tenant + workspace
 * scoped — a forged or foreign id resolves to NOT FOUND, never to another
 * workspace's record (the one authorization model).
 */

import type { TenantId, WorkspaceId } from '@nexora/contracts/common';

import type { WebhookDelivery } from '../domain/webhook-delivery.js';
import type { WebhookEndpoint } from '../domain/webhook-endpoint.js';
import type { EmailRecord } from '../domain/email-record.js';

/** Persistence for {@link WebhookEndpoint} aggregates. */
export interface WebhookEndpointRepository {
  /** Loads an endpoint by id (any tenant — callers scope before use). */
  findById(id: string): Promise<WebhookEndpoint | undefined>;
  /** Loads an endpoint by id scoped to a tenant. */
  findByIdAndTenant(id: string, tenantId: TenantId): Promise<WebhookEndpoint | undefined>;
  /** Lists the endpoints of a workspace (tenant-scoped). */
  listByWorkspace(
    tenantId: TenantId,
    workspaceId: WorkspaceId,
  ): Promise<readonly WebhookEndpoint[]>;
  /** Lists the enabled endpoints subscribing to an event type (dispatcher). */
  listSubscribed(
    tenantId: TenantId,
    workspaceId: WorkspaceId,
    eventType: string,
  ): Promise<readonly WebhookEndpoint[]>;
  /** Saves (insert or update) an endpoint. */
  save(endpoint: WebhookEndpoint): Promise<void>;
  /** Removes an endpoint. */
  remove(endpoint: WebhookEndpoint): Promise<void>;
}

/** Persistence for {@link WebhookDelivery} receipts. */
export interface WebhookDeliveryRepository {
  /** Loads a receipt by id scoped to a tenant. */
  findByIdAndTenant(id: string, tenantId: TenantId): Promise<WebhookDelivery | undefined>;
  /** Lists the receipts of an endpoint (tenant-scoped, newest first). */
  listByEndpoint(
    tenantId: TenantId,
    endpointId: string,
    options?: { limit?: number },
  ): Promise<readonly WebhookDelivery[]>;
  /** Saves an append-only receipt. */
  save(delivery: WebhookDelivery): Promise<void>;
}

/**
 * The exactly-once claim ledger of the signed inbound email endpoint (S21
 * red-team finding IN-01). One row per accepted external message id; the
 * unique (tenant, message_id) constraint makes the claim atomic — the
 * first delivery of a message id wins, every replayed delivery fails the
 * insert and is rejected without re-executing the routed action.
 */
export interface InboundMessageRepository {
  /**
   * Atomically claims a message id for a tenant. Returns `true` only for
   * the FIRST delivery; `false` when the id was already handled (replay).
   */
  claim(input: {
    tenantId: TenantId;
    workspaceId: WorkspaceId;
    messageId: string;
    action: string;
    targetId: string;
    handledAt: string;
  }): Promise<boolean>;
}

/** Persistence for the email outbox ({@link EmailRecord}). */
export interface EmailOutboxRepository {
  /** Loads an outbox record by id scoped to a tenant. */
  findByIdAndTenant(id: string, tenantId: TenantId): Promise<EmailRecord | undefined>;
  /**
   * Loads an outbox record by its source event id (the dedupe key of the
   * email projection — at-least-once delivery must never double-send).
   */
  findBySourceEventId(sourceEventId: string, tenantId: TenantId): Promise<EmailRecord | undefined>;
  /** Lists the outbox records of a tenant (newest first). */
  listByTenant(
    tenantId: TenantId,
    options?: { workspaceId?: WorkspaceId; limit?: number },
  ): Promise<readonly EmailRecord[]>;
  /** Saves an outbox record. */
  save(record: EmailRecord): Promise<void>;
}
