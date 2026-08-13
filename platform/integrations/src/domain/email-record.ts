/**
 * @nexora/module-integrations — EmailRecord (outbox).
 *
 * A persisted record of an email notification dispatched through the email
 * channel (V1-9 "email (notifications)"). The record is the outbox — in the
 * MVP the delivery adapter is a dev sink (structured log); a production SMTP
 * adapter can be swapped behind the same {@link EmailSender} port without
 * changing the domain (BKD §9.1: connectors are adapters).
 *
 * Security invariant: the subject/body come from the deterministic
 * notification policy (trusted server text) — never from raw payload blobs
 * or model output. Recipients are the trusted event actors.
 */

import { prefixedId } from '@nexora/shared/ids';
import { nowIso } from '@nexora/shared/time';
import type { TenantId, WorkspaceId } from '@nexora/contracts/common';

/** The terminal dispatch state of an email record. */
export type EmailRecordStatus = 'sent';

/** Input for creating an {@link EmailRecord}. */
export interface CreateEmailRecordInput {
  /** The owning organization (tenant) id. */
  tenantId: TenantId;
  /** The workspace scope, when the source notification was workspace-scoped. */
  workspaceId?: WorkspaceId;
  /** The recipient user id. */
  recipientId: string;
  /** The recipient email address (from the trusted identity read). */
  recipientEmail: string;
  /** The subject line (policy-derived). */
  subject: string;
  /** The body text (policy-derived). */
  body: string;
  /** The source business event id (dedupe key). */
  sourceEventId: string;
  /** The correlation id of the source event. */
  correlationId: string;
}

/** A persistence snapshot of the {@link EmailRecord}. */
export interface EmailRecordSnapshot {
  /** The outbox record id. */
  id: string;
  /** The owning organization (tenant) id. */
  tenantId: TenantId;
  /** The workspace scope, when the source notification was workspace-scoped. */
  workspaceId?: WorkspaceId;
  /** The recipient user id. */
  recipientId: string;
  /** The recipient email address. */
  recipientEmail: string;
  /** The subject line. */
  subject: string;
  /** The body text. */
  body: string;
  /** The source business event id. */
  sourceEventId: string;
  /** The correlation id of the source event. */
  correlationId: string;
  /** ISO-8601 UTC dispatch time. */
  dispatchedAt: string;
}

/**
 * An email outbox record. Use {@link EmailRecord.create} to construct.
 */
export class EmailRecord {
  #id: string;
  readonly #tenantId: TenantId;
  readonly #workspaceId?: WorkspaceId;
  readonly #recipientId: string;
  readonly #recipientEmail: string;
  readonly #subject: string;
  readonly #body: string;
  readonly #sourceEventId: string;
  readonly #correlationId: string;
  readonly #dispatchedAt: string;

  private constructor(input: CreateEmailRecordInput, dispatchedAt: string) {
    this.#id = prefixedId('ema') as string;
    this.#tenantId = input.tenantId;
    this.#workspaceId = input.workspaceId;
    this.#recipientId = input.recipientId;
    this.#recipientEmail = input.recipientEmail;
    this.#subject = input.subject;
    this.#body = input.body;
    this.#sourceEventId = input.sourceEventId;
    this.#correlationId = input.correlationId;
    this.#dispatchedAt = dispatchedAt;
  }

  /** Creates a new outbox record. */
  static create(input: CreateEmailRecordInput, dispatchedAt = nowIso()): EmailRecord {
    return new EmailRecord(input, dispatchedAt);
  }

  /** The outbox record id. */
  get id(): string {
    return this.#id;
  }

  /** The owning organization (tenant) id. */
  get tenantId(): TenantId {
    return this.#tenantId;
  }

  /** The workspace scope, when the source notification was workspace-scoped. */
  get workspaceId(): WorkspaceId | undefined {
    return this.#workspaceId;
  }

  /** The recipient user id. */
  get recipientId(): string {
    return this.#recipientId;
  }

  /** The recipient email address. */
  get recipientEmail(): string {
    return this.#recipientEmail;
  }

  /** The subject line. */
  get subject(): string {
    return this.#subject;
  }

  /** The body text. */
  get body(): string {
    return this.#body;
  }

  /** The source business event id. */
  get sourceEventId(): string {
    return this.#sourceEventId;
  }

  /** The correlation id of the source event. */
  get correlationId(): string {
    return this.#correlationId;
  }

  /** ISO-8601 UTC dispatch time. */
  get dispatchedAt(): string {
    return this.#dispatchedAt;
  }

  /** Produces a persistence snapshot of the record. */
  static snapshot(record: EmailRecord): EmailRecordSnapshot {
    return {
      id: record.id,
      tenantId: record.tenantId,
      workspaceId: record.workspaceId,
      recipientId: record.recipientId,
      recipientEmail: record.recipientEmail,
      subject: record.subject,
      body: record.body,
      sourceEventId: record.sourceEventId,
      correlationId: record.correlationId,
      dispatchedAt: record.dispatchedAt,
    };
  }

  /** Reconstructs a record from a persistence snapshot (append-only). */
  static hydrate(snapshot: EmailRecordSnapshot): EmailRecord {
    const record = new EmailRecord(snapshot, snapshot.dispatchedAt);
    // Reconstitution restores the persisted id (never regenerates one).
    record.#id = snapshot.id;
    return record;
  }
}
