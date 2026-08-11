/**
 * @nexora/domain-documents — DocumentDomainService.
 *
 * Orchestrates the {@link Document} aggregate lifecycle (DOMAIN_MODEL.md
 * §14 Documents): upload, processing transitions, and archival. Owns the
 * use-case workflows that span the aggregate and its repository; the
 * aggregate enforces its own invariants. All methods return a `Result` so
 * expected failures are explicit values, not exceptions.
 */

import type { EventEnvelope } from '@nexora/shared/events';
import type { Result } from '@nexora/shared/result';
import { err, ok } from '@nexora/shared/result';
import type { TenantId, UserId, WorkspaceId } from '@nexora/contracts/common';

import { Document } from '../entities/document.js';
import type { DocumentEventContext } from '../events/index.js';
import {
  DocumentNotFoundError,
  toDocumentError,
  type DocumentDomainError,
} from '../errors/index.js';
import type { DocumentRepository } from '../repositories/index.js';
import type { DocumentId } from '../value-objects/document-id.js';
import { ContentRef } from '../value-objects/content-ref.js';

/** Input for creating a document record (metadata only — content via storage). */
export interface CreateDocumentRecordCommand {
  /** The owning organization (tenant) id. */
  organizationId: TenantId;
  /** The owning workspace id. */
  workspaceId: WorkspaceId;
  /** The uploading user id. */
  uploaderId: UserId;
  /** The document title. */
  title: string;
  /** The upload content type. */
  contentType: string;
  /** The storage reference of the binary content. */
  contentRef: string;
}

/** The outcome of a document command: the aggregate plus emitted events. */
export interface DocumentCommandResult {
  /** The mutated aggregate. */
  document: Document;
  /** Domain events emitted by the operation (publish via the event bus). */
  events: readonly EventEnvelope[];
}

/** Dependencies of the {@link DocumentDomainService}. */
export interface DocumentDomainServiceDependencies {
  /** Document persistence. */
  documents: DocumentRepository;
}

/**
 * The document lifecycle use-case service.
 */
export class DocumentDomainService {
  readonly #documents: DocumentRepository;

  constructor(dependencies: DocumentDomainServiceDependencies) {
    this.#documents = dependencies.documents;
  }

  /**
   * Creates a document record in `uploaded` status (the binary content is
   * already stored by the caller — metadata first, processing next).
   */
  async createRecord(
    input: CreateDocumentRecordCommand,
    context: DocumentEventContext,
  ): Promise<Result<DocumentCommandResult, DocumentDomainError>> {
    try {
      const document = Document.create(
        {
          organizationId: input.organizationId,
          workspaceId: input.workspaceId,
          uploaderId: input.uploaderId,
          title: input.title,
          contentType: input.contentType,
        },
        ContentRef.create(input.contentRef),
        context,
      );
      await this.#documents.save(document);
      return ok({ document, events: document.pullDomainEvents() });
    } catch (error) {
      return err(toDocumentError(error));
    }
  }

  /** Starts processing (`uploaded` → `processing`). */
  async markProcessing(
    documentId: DocumentId,
    context: DocumentEventContext,
  ): Promise<Result<DocumentCommandResult, DocumentDomainError>> {
    try {
      const document = await this.#requireDocument(documentId);
      document.markProcessing(context);
      await this.#documents.save(document);
      return ok({ document, events: document.pullDomainEvents() });
    } catch (error) {
      return err(toDocumentError(error));
    }
  }

  /** Completes processing (`processing` → `available` — searchable now). */
  async completeProcessing(
    documentId: DocumentId,
    context: DocumentEventContext,
  ): Promise<Result<DocumentCommandResult, DocumentDomainError>> {
    try {
      const document = await this.#requireDocument(documentId);
      document.completeProcessing(context);
      await this.#documents.save(document);
      return ok({ document, events: document.pullDomainEvents() });
    } catch (error) {
      return err(toDocumentError(error));
    }
  }

  /** Fails processing (`processing` → `failed` — retryable, never searchable). */
  async failProcessing(
    documentId: DocumentId,
    reason: string,
    context: DocumentEventContext,
  ): Promise<Result<DocumentCommandResult, DocumentDomainError>> {
    try {
      const document = await this.#requireDocument(documentId);
      document.failProcessing(reason, context);
      await this.#documents.save(document);
      return ok({ document, events: document.pullDomainEvents() });
    } catch (error) {
      return err(toDocumentError(error));
    }
  }

  /** Archives a document (`available` → `archived` — leaves the index). */
  async archive(
    documentId: DocumentId,
    context: DocumentEventContext,
  ): Promise<Result<DocumentCommandResult, DocumentDomainError>> {
    try {
      const document = await this.#requireDocument(documentId);
      document.archive(context);
      await this.#documents.save(document);
      return ok({ document, events: document.pullDomainEvents() });
    } catch (error) {
      return err(toDocumentError(error));
    }
  }

  /** Finds a document by id, or a {@link DocumentNotFoundError}. */
  async findById(documentId: DocumentId): Promise<Result<Document, DocumentNotFoundError>> {
    const document = await this.#documents.findById(documentId);
    if (document === undefined) {
      return err(new DocumentNotFoundError({ documentId }));
    }
    return ok(document);
  }

  /** Lists the documents of a workspace (workspace-scoped read). */
  async listByWorkspace(
    organizationId: TenantId,
    workspaceId: WorkspaceId,
  ): Promise<Result<readonly Document[], never>> {
    return ok(await this.#documents.listByWorkspace(organizationId, workspaceId));
  }

  /** Loads a document or throws {@link DocumentNotFoundError}. */
  async #requireDocument(documentId: DocumentId): Promise<Document> {
    const document = await this.#documents.findById(documentId);
    if (document === undefined) {
      throw new DocumentNotFoundError({ documentId });
    }
    return document;
  }
}
