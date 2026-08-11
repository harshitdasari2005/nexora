/**
 * @nexora/domain-documents — Document aggregate root.
 *
 * The central aggregate of the Documents bounded context (DOMAIN_MODEL.md
 * §14 Documents): a file record owned by exactly one organization (the
 * `organizationId`, immutable) and one workspace (the `workspaceId`,
 * immutable), with a title and a processing lifecycle (`uploaded →
 * processing → available`; `failed` from processing, retryable; `archived`
 * terminal from available). Authorization is NEVER derived from the
 * filename or content — the aggregate carries its scope explicitly, and
 * every read/write is gated by the trusted tenant + workspace.
 *
 * The aggregate holds METADATA only. Binary content lives behind the
 * {@link ContentRef} storage key — the domain never sees bytes.
 * All state changes flow through aggregate methods, which enforce business
 * invariants and record domain events. No partial aggregate mutation on
 * validation failure: transitions validate the policy FIRST, then mutate,
 * then emit the event.
 */

import type { EventEnvelope } from '@nexora/shared/events';
import { nowIso } from '@nexora/shared/time';
import type { TenantId, UserId, WorkspaceId } from '@nexora/contracts/common';

import type { DocumentEventContext } from '../events/index.js';
import {
  documentArchivedEvent,
  documentAvailableEvent,
  documentProcessingFailedEvent,
  documentProcessingStartedEvent,
  documentUploadedEvent,
} from '../events/index.js';
import { DocumentStateTransitionError } from '../errors/index.js';
import { DOCUMENT_TRANSITIONS } from '../policies/index.js';
import type { DocumentId } from '../value-objects/document-id.js';
import { DocumentId as DocumentIdFactory } from '../value-objects/document-id.js';
import { DocumentStatus } from '../value-objects/document-status.js';
import { DocumentTitle } from '../value-objects/document-title.js';
import { ContentRef } from '../value-objects/content-ref.js';

/** Input for creating a new {@link Document}. */
export interface CreateDocumentInput {
  /** The owning organization (tenant) id — immutable. */
  organizationId: TenantId;
  /** The owning workspace id — immutable (workspace isolation). */
  workspaceId: WorkspaceId;
  /** The uploading user id (the owner/uploader). */
  uploaderId: UserId;
  /** The document title (validated). */
  title: string;
  /** The upload content type (e.g. `text/plain`, `application/pdf`). */
  contentType: string;
}

/** A persistence snapshot of the {@link Document} aggregate. */
export interface DocumentSnapshot {
  /** The document id. */
  id: DocumentId;
  /** The owning organization (tenant) id. */
  organizationId: TenantId;
  /** The owning workspace id. */
  workspaceId: WorkspaceId;
  /** The uploading user id. */
  uploaderId: UserId;
  /** The title. */
  title: string;
  /** The upload content type. */
  contentType: string;
  /** The storage reference of the binary content. */
  contentRef: string;
  /** The lifecycle status value. */
  status: string;
  /** A safe failure reason, when processing failed. */
  failureReason?: string;
  /** The content version (bumped on each successful processing). */
  contentVersion: number;
  /** ISO-8601 UTC creation time. */
  createdAt: string;
  /** ISO-8601 UTC last mutation time. */
  updatedAt: string;
  /** Monotonic version for optimistic concurrency. */
  version: number;
}

/**
 * The {@link Document} aggregate root. Use {@link Document.create} to
 * construct; mutate only through aggregate methods so invariants stay
 * protected.
 */
export class Document {
  // Not `readonly`: reassigned only by `hydrate` (reconstitution).
  #id: DocumentId;
  readonly #organizationId: TenantId;
  readonly #workspaceId: WorkspaceId;
  readonly #uploaderId: UserId;
  readonly #title: DocumentTitle;
  readonly #contentType: string;
  readonly #contentRef: ContentRef;
  #status: DocumentStatus;
  #failureReason?: string;
  #contentVersion: number;
  readonly #createdAt: string;
  #updatedAt: string;
  #version: number;
  readonly #events: EventEnvelope[] = [];

  private constructor(input: CreateDocumentInput, contentRef: ContentRef, createdAt: string) {
    this.#id = DocumentIdFactory.create();
    this.#organizationId = input.organizationId;
    this.#workspaceId = input.workspaceId;
    this.#uploaderId = input.uploaderId;
    this.#title = DocumentTitle.create(input.title);
    this.#contentType = input.contentType.trim();
    this.#contentRef = contentRef;
    this.#status = DocumentStatus.uploaded();
    this.#contentVersion = 1;
    this.#createdAt = createdAt;
    this.#updatedAt = createdAt;
    this.#version = 1;
  }

  /**
   * Creates a new {@link Document} in `uploaded` status (metadata persisted
   * BEFORE processing) and records a {@link documentUploadedEvent}.
   */
  static create(
    input: CreateDocumentInput,
    contentRef: ContentRef,
    context: DocumentEventContext,
    now = nowIso(),
  ): Document {
    const document = new Document(input, contentRef, now);
    document.#events.push(
      documentUploadedEvent(context, document.#id, {
        documentId: document.#id,
        title: document.#title.value,
        organizationId: document.#organizationId,
        workspaceId: document.#workspaceId,
        uploaderId: document.#uploaderId,
        status: document.#status.value,
      }),
    );
    return document;
  }

  /** The document id. */
  get id(): DocumentId {
    return this.#id;
  }

  /** The owning organization (tenant) id — immutable (exactly one org). */
  get organizationId(): TenantId {
    return this.#organizationId;
  }

  /** The owning workspace id — immutable (workspace isolation). */
  get workspaceId(): WorkspaceId {
    return this.#workspaceId;
  }

  /** The uploading user id. */
  get uploaderId(): UserId {
    return this.#uploaderId;
  }

  /** The document title. */
  get title(): DocumentTitle {
    return this.#title;
  }

  /** The upload content type. */
  get contentType(): string {
    return this.#contentType;
  }

  /** The storage reference of the binary content. */
  get contentRef(): ContentRef {
    return this.#contentRef;
  }

  /** The processing lifecycle status. */
  get status(): DocumentStatus {
    return this.#status;
  }

  /** A safe failure reason, when processing failed. */
  get failureReason(): string | undefined {
    return this.#failureReason;
  }

  /** The content version (bumped on each successful processing). */
  get contentVersion(): number {
    return this.#contentVersion;
  }

  /** ISO-8601 UTC creation time. */
  get createdAt(): string {
    return this.#createdAt;
  }

  /** ISO-8601 UTC time of the last mutation. */
  get updatedAt(): string {
    return this.#updatedAt;
  }

  /** Monotonic version for optimistic concurrency (EntityMeta). */
  get version(): number {
    return this.#version;
  }

  /** Whether the document is searchable by the knowledge system. */
  isAvailable(): boolean {
    return this.#status.isAvailable();
  }

  /**
   * Starts processing (`uploaded` → `processing` — extraction begins) and
   * records a {@link documentProcessingStartedEvent}.
   *
   * @throws {DocumentStateTransitionError} when the transition is not allowed.
   */
  markProcessing(context: DocumentEventContext, now = nowIso()): void {
    this.#transitionTo(DocumentStatus.processing(), 'process', now);
    this.#events.push(documentProcessingStartedEvent(context, this.#id));
  }

  /**
   * Completes processing (`processing` → `available` — extraction + indexing
   * ready) and records a {@link documentAvailableEvent}. The content version
   * is bumped: the new content becomes the active searchable version.
   *
   * @throws {DocumentStateTransitionError} when the transition is not allowed.
   */
  completeProcessing(context: DocumentEventContext, now = nowIso()): void {
    this.#transitionTo(DocumentStatus.available(), 'complete', now);
    this.#contentVersion += 1;
    this.#failureReason = undefined;
    this.#events.push(documentAvailableEvent(context, this.#id, this.#contentVersion));
  }

  /**
   * Fails processing (`processing` → `failed` — retryable) and records a
   * {@link documentProcessingFailedEvent}. No version is bumped — the failed
   * content is never searchable.
   *
   * @param reason - a safe, user-facing reason (never internal details).
   * @throws {DocumentStateTransitionError} when the transition is not allowed.
   */
  failProcessing(reason: string, context: DocumentEventContext, now = nowIso()): void {
    this.#transitionTo(DocumentStatus.failed(), 'fail', now);
    this.#failureReason = reason.slice(0, 500);
    this.#events.push(documentProcessingFailedEvent(context, this.#id, this.#failureReason));
  }

  /**
   * Archives the document (`available` → `archived` — no longer searchable)
   * and records a {@link documentArchivedEvent}. Archived is terminal in v1.
   *
   * @throws {DocumentStateTransitionError} when the transition is not allowed.
   */
  archive(context: DocumentEventContext, now = nowIso()): void {
    this.#transitionTo(DocumentStatus.archived(), 'archive', now);
    this.#events.push(documentArchivedEvent(context, this.#id));
  }

  /**
   * Produces a persistence snapshot of the document (PERSISTENCE.md §4
   * aggregate ownership).
   */
  static snapshot(document: Document): DocumentSnapshot {
    return {
      id: document.id,
      organizationId: document.organizationId,
      workspaceId: document.workspaceId,
      uploaderId: document.uploaderId,
      title: document.title.value,
      contentType: document.contentType,
      contentRef: document.contentRef.value,
      status: document.status.value,
      failureReason: document.failureReason,
      contentVersion: document.contentVersion,
      createdAt: document.createdAt,
      updatedAt: document.updatedAt,
      version: document.version,
    };
  }

  /**
   * Reconstructs a {@link Document} from a persistence snapshot without
   * emitting domain events (DDD reconstitution factory). Reuses the id and
   * content reference from the snapshot; values are re-validated through
   * the value-object factories at load.
   */
  static hydrate(snapshot: DocumentSnapshot): Document {
    const document = new Document(
      {
        organizationId: snapshot.organizationId,
        workspaceId: snapshot.workspaceId,
        uploaderId: snapshot.uploaderId,
        title: snapshot.title,
        contentType: snapshot.contentType,
      },
      ContentRef.create(snapshot.contentRef),
      snapshot.createdAt,
    );
    document.#id = snapshot.id;
    document.#status = DocumentStatus.from(snapshot.status);
    document.#failureReason = snapshot.failureReason;
    document.#contentVersion = snapshot.contentVersion;
    document.#updatedAt = snapshot.updatedAt;
    document.#version = snapshot.version;
    return document;
  }

  /** Returns and clears the recorded domain events. */
  pullDomainEvents(): readonly EventEnvelope[] {
    const events = [...this.#events];
    this.#events.length = 0;
    return events;
  }

  /** Enforces the document lifecycle transition table (validate → mutate → event). */
  #transitionTo(target: DocumentStatus, action: string, now: string): void {
    const allowed = DOCUMENT_TRANSITIONS[this.#status.value];
    if (!allowed.includes(target.value)) {
      throw new DocumentStateTransitionError(
        `Cannot ${action} a document in status ${this.#status.value}`,
        { documentId: this.#id, from: this.#status.value, to: target.value },
      );
    }
    // Validate → mutate: the transition is legal, then mutate and record.
    this.#status = target;
    this.#bump(now);
  }

  /** Bumps the version and updated-at timestamp (optimistic concurrency). */
  #bump(now = nowIso()): void {
    this.#version += 1;
    this.#updatedAt = now;
  }
}
