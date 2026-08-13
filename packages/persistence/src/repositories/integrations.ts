/**
 * @nexora/persistence — integrations repositories.
 *
 * Drizzle implementations of the Integrations module repository ports
 * (`WebhookEndpointRepository`, `WebhookDeliveryRepository`,
 * `EmailOutboxRepository`). Aggregates are serialized via `snapshot()` and
 * reconstructed via `hydrate()` (PERSISTENCE.md §4 aggregate ownership).
 *
 * Every read is tenant-scoped in SQL FIRST (defense-in-depth): an endpoint
 * or outbox id alone grants nothing, and a foreign or cross-workspace id
 * resolves to NOT FOUND — never to another workspace's record. The email
 * outbox unique (tenant, source_event) index is the idempotency key.
 */

import { and, desc, eq, isNull, or, type SQL } from 'drizzle-orm';
import type { TenantId, WorkspaceId } from '@nexora/contracts/common';
import {
  EmailRecord,
  WebhookDelivery,
  WebhookEndpoint,
  type EmailOutboxRepository,
  type WebhookDeliveryRepository,
  type WebhookEndpointRepository,
} from '@nexora/module-integrations';

import type { NexoraDatabase } from '../db.js';
import { emailOutbox, webhookDeliveries, webhookEndpoints } from '../schema/index.js';

/** Converts a persisted timestamp (Date or string) to an ISO string. */
function toIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : value;
}

/** Converts an ISO string to a Date for storage. */
function toDate(iso: string): Date {
  return new Date(iso);
}

// --- WebhookEndpoint mapping ---------------------------------------------

type WebhookEndpointRow = typeof webhookEndpoints.$inferSelect;

function rowToWebhookEndpointSnapshot(
  row: WebhookEndpointRow,
): ReturnType<typeof WebhookEndpoint.snapshot> {
  return {
    id: row.id,
    organizationId: row.organizationId as TenantId,
    workspaceId: row.workspaceId as WorkspaceId,
    url: row.url,
    secret: row.secret,
    eventTypes: Array.isArray(row.eventTypes) ? row.eventTypes : [],
    enabled: row.enabled,
    createdAt: toIso(row.createdAt),
    updatedAt: toIso(row.updatedAt),
    version: row.version,
  };
}

function webhookEndpointSnapshotToRow(
  snapshot: ReturnType<typeof WebhookEndpoint.snapshot>,
): WebhookEndpointRow {
  return {
    id: snapshot.id,
    organizationId: snapshot.organizationId,
    workspaceId: snapshot.workspaceId,
    url: snapshot.url,
    secret: snapshot.secret,
    eventTypes: [...snapshot.eventTypes],
    enabled: snapshot.enabled,
    createdAt: toDate(snapshot.createdAt),
    updatedAt: toDate(snapshot.updatedAt),
    version: snapshot.version,
  };
}

/** The PostgreSQL {@link WebhookEndpointRepository} implementation. */
export class PgWebhookEndpointRepository implements WebhookEndpointRepository {
  readonly #db: NexoraDatabase;

  constructor(db: NexoraDatabase) {
    this.#db = db;
  }

  async findById(id: string): Promise<WebhookEndpoint | undefined> {
    const rows = await this.#db
      .select()
      .from(webhookEndpoints)
      .where(eq(webhookEndpoints.id, id))
      .limit(1);
    const row = rows[0];
    return row === undefined
      ? undefined
      : WebhookEndpoint.hydrate(rowToWebhookEndpointSnapshot(row));
  }

  async findByIdAndTenant(id: string, tenantId: TenantId): Promise<WebhookEndpoint | undefined> {
    const rows = await this.#db
      .select()
      .from(webhookEndpoints)
      .where(and(eq(webhookEndpoints.id, id), eq(webhookEndpoints.organizationId, tenantId)))
      .limit(1);
    const row = rows[0];
    return row === undefined
      ? undefined
      : WebhookEndpoint.hydrate(rowToWebhookEndpointSnapshot(row));
  }

  async listByWorkspace(
    tenantId: TenantId,
    workspaceId: WorkspaceId,
  ): Promise<readonly WebhookEndpoint[]> {
    const rows = await this.#db
      .select()
      .from(webhookEndpoints)
      .where(
        and(
          eq(webhookEndpoints.organizationId, tenantId),
          eq(webhookEndpoints.workspaceId, workspaceId),
        ),
      )
      .orderBy(desc(webhookEndpoints.createdAt), desc(webhookEndpoints.id));
    return rows.map((row) => WebhookEndpoint.hydrate(rowToWebhookEndpointSnapshot(row)));
  }

  async listSubscribed(
    tenantId: TenantId,
    workspaceId: WorkspaceId,
    eventType: string,
  ): Promise<readonly WebhookEndpoint[]> {
    const rows = await this.#db
      .select()
      .from(webhookEndpoints)
      .where(
        and(
          eq(webhookEndpoints.organizationId, tenantId),
          eq(webhookEndpoints.workspaceId, workspaceId),
          eq(webhookEndpoints.enabled, true),
        ),
      )
      .orderBy(desc(webhookEndpoints.createdAt), desc(webhookEndpoints.id));
    return rows
      .map((row) => WebhookEndpoint.hydrate(rowToWebhookEndpointSnapshot(row)))
      .filter((endpoint) => endpoint.subscribesTo(eventType));
  }

  async save(endpoint: WebhookEndpoint): Promise<void> {
    const row = webhookEndpointSnapshotToRow(WebhookEndpoint.snapshot(endpoint));
    await this.#db
      .insert(webhookEndpoints)
      .values(row)
      .onConflictDoUpdate({ target: webhookEndpoints.id, set: row });
  }

  async remove(endpoint: WebhookEndpoint): Promise<void> {
    await this.#db.delete(webhookEndpoints).where(eq(webhookEndpoints.id, endpoint.id));
  }
}

// --- WebhookDelivery mapping ---------------------------------------------

type WebhookDeliveryRow = typeof webhookDeliveries.$inferSelect;

function rowToWebhookDeliverySnapshot(
  row: WebhookDeliveryRow,
): ReturnType<typeof WebhookDelivery.snapshot> {
  return {
    id: row.id,
    organizationId: row.organizationId as TenantId,
    workspaceId: row.workspaceId as WorkspaceId,
    endpointId: row.endpointId,
    eventId: row.eventId,
    eventType: row.eventType,
    status: row.status as 'delivered' | 'failed',
    attempt: row.attempt,
    statusCode: row.statusCode ?? undefined,
    error: row.error ?? undefined,
    deliveredAt: toIso(row.deliveredAt),
  };
}

function webhookDeliverySnapshotToRow(
  snapshot: ReturnType<typeof WebhookDelivery.snapshot>,
): WebhookDeliveryRow {
  return {
    id: snapshot.id,
    organizationId: snapshot.organizationId,
    workspaceId: snapshot.workspaceId,
    endpointId: snapshot.endpointId,
    eventId: snapshot.eventId,
    eventType: snapshot.eventType,
    status: snapshot.status,
    attempt: snapshot.attempt,
    statusCode: snapshot.statusCode ?? null,
    error: snapshot.error ?? null,
    deliveredAt: toDate(snapshot.deliveredAt),
  };
}

/** The PostgreSQL {@link WebhookDeliveryRepository} implementation. */
export class PgWebhookDeliveryRepository implements WebhookDeliveryRepository {
  readonly #db: NexoraDatabase;

  constructor(db: NexoraDatabase) {
    this.#db = db;
  }

  async findByIdAndTenant(id: string, tenantId: TenantId): Promise<WebhookDelivery | undefined> {
    const rows = await this.#db
      .select()
      .from(webhookDeliveries)
      .where(and(eq(webhookDeliveries.id, id), eq(webhookDeliveries.organizationId, tenantId)))
      .limit(1);
    const row = rows[0];
    return row === undefined
      ? undefined
      : WebhookDelivery.hydrate(rowToWebhookDeliverySnapshot(row));
  }

  async listByEndpoint(
    tenantId: TenantId,
    endpointId: string,
    options?: { limit?: number },
  ): Promise<readonly WebhookDelivery[]> {
    const query = this.#db
      .select()
      .from(webhookDeliveries)
      .where(
        and(
          eq(webhookDeliveries.organizationId, tenantId),
          eq(webhookDeliveries.endpointId, endpointId),
        ),
      )
      .orderBy(desc(webhookDeliveries.deliveredAt), desc(webhookDeliveries.id));
    const rows = options?.limit === undefined ? await query : await query.limit(options.limit);
    return rows.map((row) => WebhookDelivery.hydrate(rowToWebhookDeliverySnapshot(row)));
  }

  async save(delivery: WebhookDelivery): Promise<void> {
    const row = webhookDeliverySnapshotToRow(WebhookDelivery.snapshot(delivery));
    await this.#db
      .insert(webhookDeliveries)
      .values(row)
      .onConflictDoUpdate({ target: webhookDeliveries.id, set: row });
  }
}

// --- EmailOutbox mapping ---------------------------------------------------

type EmailOutboxRow = typeof emailOutbox.$inferSelect;

function rowToEmailRecordSnapshot(row: EmailOutboxRow): ReturnType<typeof EmailRecord.snapshot> {
  return {
    id: row.id,
    tenantId: row.tenantId as TenantId,
    workspaceId: (row.workspaceId as WorkspaceId) ?? undefined,
    recipientId: row.recipientId,
    recipientEmail: row.recipientEmail,
    subject: row.subject,
    body: row.body,
    sourceEventId: row.sourceEventId,
    correlationId: row.correlationId,
    dispatchedAt: toIso(row.dispatchedAt),
  };
}

function emailRecordSnapshotToRow(
  snapshot: ReturnType<typeof EmailRecord.snapshot>,
): EmailOutboxRow {
  return {
    id: snapshot.id,
    tenantId: snapshot.tenantId,
    workspaceId: snapshot.workspaceId ?? null,
    recipientId: snapshot.recipientId,
    recipientEmail: snapshot.recipientEmail,
    subject: snapshot.subject,
    body: snapshot.body,
    sourceEventId: snapshot.sourceEventId,
    correlationId: snapshot.correlationId,
    dispatchedAt: toDate(snapshot.dispatchedAt),
  };
}

/** The PostgreSQL {@link EmailOutboxRepository} implementation. */
export class PgEmailOutboxRepository implements EmailOutboxRepository {
  readonly #db: NexoraDatabase;

  constructor(db: NexoraDatabase) {
    this.#db = db;
  }

  async findByIdAndTenant(id: string, tenantId: TenantId): Promise<EmailRecord | undefined> {
    const rows = await this.#db
      .select()
      .from(emailOutbox)
      .where(and(eq(emailOutbox.id, id), eq(emailOutbox.tenantId, tenantId)))
      .limit(1);
    const row = rows[0];
    return row === undefined ? undefined : EmailRecord.hydrate(rowToEmailRecordSnapshot(row));
  }

  async findBySourceEventId(
    sourceEventId: string,
    tenantId: TenantId,
  ): Promise<EmailRecord | undefined> {
    const rows = await this.#db
      .select()
      .from(emailOutbox)
      .where(and(eq(emailOutbox.sourceEventId, sourceEventId), eq(emailOutbox.tenantId, tenantId)))
      .limit(1);
    const row = rows[0];
    return row === undefined ? undefined : EmailRecord.hydrate(rowToEmailRecordSnapshot(row));
  }

  async listByTenant(
    tenantId: TenantId,
    options?: { workspaceId?: WorkspaceId; limit?: number },
  ): Promise<readonly EmailRecord[]> {
    // `or()` may return `undefined` (drizzle ignores undefined conditions),
    // so the array is typed to hold optional conditions — `and()` drops
    // undefined entries, keeping the semantics identical.
    const filters: (SQL | undefined)[] = [eq(emailOutbox.tenantId, tenantId)];
    if (options?.workspaceId !== undefined) {
      // Workspace-scoped view includes the workspace's own emails AND the
      // org-level emails (source events without a workspace scope — every
      // tenant member may see them; the workspace filter is a view, not a
      // security boundary — the tenant id is the isolation scope).
      filters.push(
        or(eq(emailOutbox.workspaceId, options.workspaceId), isNull(emailOutbox.workspaceId)),
      );
    }
    const query = this.#db
      .select()
      .from(emailOutbox)
      .where(and(...filters))
      .orderBy(desc(emailOutbox.dispatchedAt), desc(emailOutbox.id));
    const rows = options?.limit === undefined ? await query : await query.limit(options.limit);
    return rows.map((row) => EmailRecord.hydrate(rowToEmailRecordSnapshot(row)));
  }

  async save(record: EmailRecord): Promise<void> {
    const row = emailRecordSnapshotToRow(EmailRecord.snapshot(record));
    await this.#db
      .insert(emailOutbox)
      .values(row)
      .onConflictDoUpdate({ target: emailOutbox.id, set: row });
  }
}

/** Drop-all helper used by tests that truncate the integration tables. */
export async function clearIntegrationTables(db: NexoraDatabase): Promise<void> {
  await db.delete(emailOutbox);
  await db.delete(webhookDeliveries);
  await db.delete(webhookEndpoints);
}
