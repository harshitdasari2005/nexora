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
import { nowIso } from '@nexora/shared/time';
import type { Result } from '@nexora/shared/result';
import { err, ok } from '@nexora/shared/result';
import type { TenantId, UserId, WorkspaceId } from '@nexora/contracts/common';

import { Document } from '../entities/document.js';
import { DocumentTemplate } from '../entities/document-template.js';
import { DocumentVersion } from '../entities/document-version.js';
import type { DocumentEventContext } from '../events/index.js';
import {
  DocumentNotFoundError,
  DocumentTemplateNotFoundError,
  DocumentVersionNotFoundError,
  toDocumentError,
  type DocumentDomainError,
} from '../errors/index.js';
import type {
  DocumentRepository,
  DocumentTemplateRepository,
  DocumentVersionRepository,
} from '../repositories/index.js';
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

/** The outcome of a template command: the template plus emitted events. */
export interface TemplateCommandResult {
  /** The mutated template aggregate. */
  template: DocumentTemplate;
  /** Domain events emitted by the operation (publish via the event bus). */
  events: readonly EventEnvelope[];
}

/** Dependencies of the {@link DocumentDomainService}. */
export interface DocumentDomainServiceDependencies {
  /** Document persistence. */
  documents: DocumentRepository;
  /** Immutable version-history persistence (S17). */
  versions: DocumentVersionRepository;
  /** Template persistence (S17). */
  templates: DocumentTemplateRepository;
}

/**
 * The document lifecycle use-case service.
 */
export class DocumentDomainService {
  readonly #documents: DocumentRepository;
  readonly #versions: DocumentVersionRepository;
  readonly #templates: DocumentTemplateRepository;

  constructor(dependencies: DocumentDomainServiceDependencies) {
    this.#documents = dependencies.documents;
    this.#versions = dependencies.versions;
    this.#templates = dependencies.templates;
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

  /**
   * Adopts new content as the document's current revision (a version
   * upload): replaces the content reference and bumps the content version
   * through the aggregate, then persists. Historical version records are
   * NEVER touched.
   *
   * @param revision - the monotonic revision number being adopted (the
   * caller's {@link nextVersionNumber} result) — carried by the domain event.
   */
  async adoptNewContent(
    documentId: DocumentId,
    contentRef: ContentRef,
    revision: number,
    context: DocumentEventContext,
  ): Promise<Result<DocumentCommandResult, DocumentDomainError>> {
    try {
      const document = await this.#requireDocument(documentId);
      document.uploadNewContent(contentRef, revision, context);
      await this.#documents.save(document);
      return ok({ document, events: document.pullDomainEvents() });
    } catch (error) {
      return err(toDocumentError(error));
    }
  }

  /**
   * Restores a historical version's content as a NEW current revision:
   * copies the restored content forward into a fresh content reference
   * through the aggregate (never mutating history), then persists.
   *
   * @param revision - the monotonic revision number of the restored copy
   * (the caller's {@link nextVersionNumber} result) — carried by the domain
   * event.
   */
  async restoreContent(
    documentId: DocumentId,
    contentRef: ContentRef,
    restoredFromVersion: number,
    revision: number,
    context: DocumentEventContext,
  ): Promise<Result<DocumentCommandResult, DocumentDomainError>> {
    try {
      const document = await this.#requireDocument(documentId);
      document.restoreContent(contentRef, restoredFromVersion, revision, context);
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

  /**
   * Computes the NEXT monotonic version number for a document (max recorded
   * version + 1, or 1 for a document with no recorded history). The number is
   * derived from the HISTORY — never from the aggregate's legacy
   * `contentVersion` counter.
   *
   * Concurrency note (v1 limitation): the read here and the {@link addVersion}
   * write are not atomic — two concurrent uploads/restores on the same
   * document can compute the same number. The (document_id, version) unique
   * persistence constraint is the fail-safe: the losing write fails with a
   * conflict instead of corrupting history. A later sprint may serialize per
   * document (transaction or advisory lock) without changing the domain.
   */
  async nextVersionNumber(documentId: DocumentId): Promise<number> {
    const history = await this.#versions.listByDocument(documentId);
    const max = history.reduce((highest, version) => Math.max(highest, version.version), 0);
    return max + 1;
  }

  /**
   * Appends an immutable content revision to a document's history. The
   * version number MUST be the caller's {@link nextVersionNumber} result
   * (monotonicity is enforced here and by the (document_id, version)
   * unique persistence constraint — the fail-safe under concurrent writes).
   */
  async addVersion(
    input: {
      documentId: DocumentId;
      organizationId: TenantId;
      workspaceId: WorkspaceId;
      version: number;
      contentRef: string;
      contentType: string;
      restoredFromVersion?: number;
      createdBy: UserId;
    },
    now = nowIso(),
  ): Promise<Result<DocumentVersion, DocumentDomainError>> {
    try {
      const version = DocumentVersion.create(
        {
          documentId: input.documentId,
          organizationId: input.organizationId,
          workspaceId: input.workspaceId,
          version: input.version,
          contentRef: input.contentRef,
          contentType: input.contentType,
          restoredFromVersion: input.restoredFromVersion,
          createdBy: input.createdBy,
        },
        now,
      );
      await this.#versions.save(version);
      return ok(version);
    } catch (error) {
      return err(toDocumentError(error));
    }
  }

  /**
   * Loads a specific content revision of a document, or a
   * {@link DocumentVersionNotFoundError} (invalid combinations fail safe).
   */
  async requireVersion(
    documentId: DocumentId,
    version: number,
  ): Promise<Result<DocumentVersion, DocumentVersionNotFoundError>> {
    const found = await this.#versions.findByDocumentAndVersion(documentId, version);
    if (found === undefined) {
      return err(new DocumentVersionNotFoundError({ documentId, version }));
    }
    return ok(found);
  }

  /** Lists the immutable content revisions of a document, oldest first. */
  async listVersions(documentId: DocumentId): Promise<Result<readonly DocumentVersion[], never>> {
    return ok(await this.#versions.listByDocument(documentId));
  }

  /** Creates an active template and persists it. */
  async createTemplate(
    input: {
      organizationId: TenantId;
      workspaceId: WorkspaceId;
      createdBy: UserId;
      name: string;
      description?: string;
      contentType: string;
      contentRef: string;
    },
    context: DocumentEventContext,
  ): Promise<Result<TemplateCommandResult, DocumentDomainError>> {
    try {
      const template = DocumentTemplate.create(input, context);
      await this.#templates.save(template);
      return ok({ template, events: template.pullDomainEvents() });
    } catch (error) {
      return err(toDocumentError(error));
    }
  }

  /** Archives a template (`active` → `archived`). */
  async archiveTemplate(
    templateId: string,
    context: DocumentEventContext,
  ): Promise<Result<TemplateCommandResult, DocumentDomainError>> {
    try {
      const template = await this.#requireTemplate(templateId);
      template.archive(context);
      await this.#templates.save(template);
      return ok({ template, events: template.pullDomainEvents() });
    } catch (error) {
      return err(toDocumentError(error));
    }
  }

  /** Lists the ACTIVE templates of a workspace (the template picker read). */
  async listActiveTemplatesByWorkspace(
    organizationId: TenantId,
    workspaceId: WorkspaceId,
  ): Promise<Result<readonly DocumentTemplate[], never>> {
    return ok(await this.#templates.listActiveByWorkspace(organizationId, workspaceId));
  }

  /** Finds a template by id, or a {@link DocumentTemplateNotFoundError}. */
  async findTemplateById(
    templateId: string,
  ): Promise<Result<DocumentTemplate, DocumentTemplateNotFoundError>> {
    const template = await this.#templates.findById(templateId);
    if (template === undefined) {
      return err(new DocumentTemplateNotFoundError({ templateId }));
    }
    return ok(template);
  }

  /** Loads a template or throws {@link DocumentTemplateNotFoundError}. */
  async #requireTemplate(templateId: string): Promise<DocumentTemplate> {
    const template = await this.#templates.findById(templateId);
    if (template === undefined) {
      throw new DocumentTemplateNotFoundError({ templateId });
    }
    return template;
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
