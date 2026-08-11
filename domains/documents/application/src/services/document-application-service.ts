/**
 * @nexora/application-documents — DocumentApplicationService.
 *
 * The application layer orchestrator (BACKEND.md §4): coordinates the
 * documents domain service, the storage port, and the text-extraction port,
 * collects emitted domain events, and publishes them once. It contains no
 * business rules of its own — every invariant is enforced by the domain.
 *
 * The upload pipeline is synchronous in v1: store bytes → persist metadata
 * → processing → extract → available/failed (the processing seam is
 * replaceable; a later sprint can move it to a queue without changing the
 * domain or the API boundary). Scope (tenant + workspace) is TRUSTED
 * server-side state — the service verifies every read/write against it and
 * a foreign document id resolves to NOT FOUND, never to another
 * workspace's record.
 */

import type { TenantId, WorkspaceId } from '@nexora/contracts/common';
import type { EventEnvelope, EventPublisher } from '@nexora/shared/events';
import { toNexoraError, type NexoraError } from '@nexora/shared/errors';
import { err, ok, type Result } from '@nexora/shared/result';
import {
  ContentRef,
  DocumentId,
  DocumentNotFoundError,
  type Document,
  type DocumentEventContext,
  type DocumentRepository,
  type DocumentDomainService,
} from '@nexora/domain-documents';

import type {
  ArchiveDocumentCommand,
  ArchiveDocumentResult,
} from '../commands/archive-document.command.js';
import type {
  UploadDocumentCommand,
  UploadDocumentResult,
} from '../commands/upload-document.command.js';
import { toDocumentDto, type DocumentDto } from '../dto/document.dto.js';
import {
  DocumentExtractionError,
  type DocumentTextExtractor,
} from '../ports/document-text-extractor.js';
import type { DocumentStorage } from '../ports/document-storage.js';
import { validateUploadDocument } from '../validators/upload-document.validator.js';

/** Dependencies of the {@link DocumentApplicationService}. */
export interface DocumentApplicationServiceDependencies {
  /** The documents domain service. */
  documentsService: DocumentDomainService;
  /** The document metadata repository (aggregate persistence). */
  documents: DocumentRepository;
  /** The object-storage port (binary content — never PostgreSQL). */
  storage: DocumentStorage;
  /** The text-extraction port (replaceable processing seam). */
  extractor: DocumentTextExtractor;
  /** Publishes domain events to the platform event stream. */
  publisher: EventPublisher;
}

/**
 * The documents application service. All methods return a `Result` so
 * expected failures are explicit values.
 */
export class DocumentApplicationService {
  readonly #documentsService: DocumentDomainService;
  readonly #documents: DocumentRepository;
  readonly #storage: DocumentStorage;
  readonly #extractor: DocumentTextExtractor;
  readonly #publisher: EventPublisher;

  constructor(dependencies: DocumentApplicationServiceDependencies) {
    this.#documentsService = dependencies.documentsService;
    this.#documents = dependencies.documents;
    this.#storage = dependencies.storage;
    this.#extractor = dependencies.extractor;
    this.#publisher = dependencies.publisher;
  }

  /**
   * Uploads a document: stores the binary content, persists the metadata
   * aggregate (`uploaded`), runs the processing pipeline (extraction →
   * `available`, or `failed` with a safe reason), and publishes all events
   * once. The extracted text is returned so the orchestration layer can
   * index the document into Knowledge without re-extracting.
   */
  async uploadDocument(
    command: UploadDocumentCommand,
  ): Promise<Result<UploadDocumentResult, NexoraError>> {
    try {
      validateUploadDocument(command);
      const context = documentContext(
        command.uploaderId,
        command.correlationId,
        command.organizationId,
      );

      // 1. Store the binary content FIRST (metadata second — a storage
      //    failure must never leave a metadata record pointing at nothing).
      const contentRef = ContentRef.forDocument(DocumentId.create(), 1);
      await this.#storage.store(contentRef.value, command.content);

      // 2. Persist the metadata aggregate in `uploaded`.
      const created = await this.#documentsService.createRecord(
        {
          organizationId: command.organizationId,
          workspaceId: command.workspaceId,
          uploaderId: command.uploaderId,
          title: command.title,
          contentType: command.contentType,
          contentRef: contentRef.value,
        },
        context,
      );
      if (!created.ok) {
        await this.#storage.remove(contentRef.value);
        return err(created.error);
      }
      const events: EventEnvelope[] = [...created.value.events];
      const documentId = created.value.document.id;

      // 3. Processing: mark → extract → available/failed. Every transition
      //    persists through the domain service (validate → mutate → event);
      //    a failed extraction produces a failed document, never a fake
      //    success and never a silent skip.
      const processing = await this.#documentsService.markProcessing(documentId, context);
      if (!processing.ok) {
        return err(processing.error);
      }
      events.push(...processing.value.events);

      let extractedText: string | undefined;
      try {
        const text = await this.#extractor.extract(command.contentType, command.content);
        const completed = await this.#documentsService.completeProcessing(documentId, context);
        if (!completed.ok) {
          return err(completed.error);
        }
        events.push(...completed.value.events);
        extractedText = text;
      } catch (error) {
        const reason =
          error instanceof DocumentExtractionError ? error.message : 'Document processing failed';
        const failed = await this.#documentsService.failProcessing(documentId, reason, context);
        if (!failed.ok) {
          return err(failed.error);
        }
        events.push(...failed.value.events);
      }

      await this.#publisher.publish(events);
      const document = await this.#requireVisibleDocument(
        documentId,
        command.organizationId,
        command.workspaceId,
      );
      return ok({ document, events, extractedText });
    } catch (error) {
      return err(toNexoraError(error, 'Unexpected document upload error'));
    }
  }

  /**
   * Archives a document (`available` → `archived`): the document must belong
   * to the trusted tenant + workspace, then the content is removed from
   * storage and the events published once. A foreign document id resolves to
   * NOT FOUND (workspace isolation is the authorization boundary).
   */
  async archiveDocument(
    command: ArchiveDocumentCommand,
  ): Promise<Result<ArchiveDocumentResult, NexoraError>> {
    try {
      const documentId = DocumentId.from(command.documentId);
      const document = await this.#requireVisibleDocument(
        documentId,
        command.organizationId,
        command.workspaceId,
      );

      const archived = await this.#documentsService.archive(
        documentId,
        documentContext(command.actorId, command.correlationId, command.organizationId),
      );
      if (!archived.ok) {
        return err(archived.error);
      }

      await this.#storage.remove(document.contentRef.value);
      await this.#publisher.publish(archived.value.events);

      return ok({ document: archived.value.document, events: archived.value.events });
    } catch (error) {
      return err(toNexoraError(error, 'Unexpected document archive error'));
    }
  }

  /**
   * Lists the documents of a workspace, newest first (workspace-scoped read
   * — never cross-workspace).
   */
  async listDocumentsByWorkspace(
    organizationId: TenantId,
    workspaceId: WorkspaceId,
  ): Promise<Result<readonly DocumentDto[], never>> {
    const listed = await this.#documentsService.listByWorkspace(organizationId, workspaceId);
    if (!listed.ok) {
      return err(listed.error);
    }
    return ok(listed.value.map((document) => toDocumentDto(document)));
  }

  /**
   * Reads one document within the trusted tenant + workspace, or NOT FOUND.
   */
  async getDocument(
    organizationId: TenantId,
    workspaceId: WorkspaceId,
    documentId: string,
  ): Promise<Result<DocumentDto, NexoraError>> {
    try {
      const document = await this.#requireVisibleDocument(
        DocumentId.from(documentId),
        organizationId,
        workspaceId,
      );
      return ok(toDocumentDto(document));
    } catch (error) {
      return err(toNexoraError(error, 'Unexpected document query error'));
    }
  }

  /**
   * Loads a document and verifies it belongs to the trusted tenant +
   * workspace — the workspace-scope authorization boundary (a foreign
   * document id resolves to NOT FOUND, never to another workspace's record).
   */
  async #requireVisibleDocument(
    documentId: Document['id'],
    organizationId: TenantId,
    workspaceId: WorkspaceId,
  ): Promise<Document> {
    const found = await this.#documents.findById(documentId);
    if (
      found === undefined ||
      found.organizationId !== organizationId ||
      found.workspaceId !== workspaceId
    ) {
      throw new DocumentNotFoundError({ documentId });
    }
    return found;
  }
}

/** Builds a documents event context (tenant known to caller). */
function documentContext(
  actorId: string,
  correlationId: string,
  organizationId: TenantId,
): DocumentEventContext {
  return { actor: { kind: 'user', id: actorId }, correlationId, organizationId };
}
