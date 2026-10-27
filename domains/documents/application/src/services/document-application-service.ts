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
  DocumentTemplateId,
  DocumentTemplateNotFoundError,
  DocumentVersionNotFoundError,
  type Document,
  type DocumentEventContext,
  type DocumentRepository,
  type DocumentDomainService,
  type DocumentTemplate,
} from '@nexora/domain-documents';

import type {
  ArchiveDocumentCommand,
  ArchiveDocumentResult,
} from '../commands/archive-document.command.js';
import type {
  CreateDocumentFromTemplateCommand,
  CreateDocumentFromTemplateResult,
} from '../commands/create-document-from-template.command.js';
import type {
  CreateDocumentTemplateCommand,
  CreateDocumentTemplateResult,
} from '../commands/create-document-template.command.js';
import type {
  ArchiveDocumentTemplateCommand,
  ArchiveDocumentTemplateResult,
} from '../commands/archive-document-template.command.js';
import type {
  RestoreDocumentVersionCommand,
  RestoreDocumentVersionResult,
} from '../commands/restore-document-version.command.js';
import type {
  UploadDocumentCommand,
  UploadDocumentResult,
} from '../commands/upload-document.command.js';
import type {
  UploadDocumentVersionCommand,
  UploadDocumentVersionResult,
} from '../commands/upload-document-version.command.js';
import { toDocumentDto, type DocumentDto } from '../dto/document.dto.js';
import { toDocumentTemplateDto, type DocumentTemplateDto } from '../dto/document-template.dto.js';
import { toDocumentVersionDto, type DocumentVersionDto } from '../dto/document-version.dto.js';
import {
  DocumentExtractionError,
  type DocumentTextExtractor,
} from '../ports/document-text-extractor.js';
import type { DocumentStorage } from '../ports/document-storage.js';
import { validateCreateDocumentTemplate } from '../validators/create-document-template.validator.js';
import { validateUploadDocument } from '../validators/upload-document.validator.js';
import { validateUploadDocumentVersion } from '../validators/upload-document-version.validator.js';

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

      // 3. Record the initial immutable content revision (v1): every
      //    persisted content revision has a version. Recorded AFTER the
      //    pipeline so the stored key matches the document's contentRef.
      const recorded = await this.#documentsService.addVersion({
        documentId,
        organizationId: command.organizationId,
        workspaceId: command.workspaceId,
        version: 1,
        contentRef: document.contentRef.value,
        contentType: command.contentType,
        createdBy: command.uploaderId,
      });
      if (!recorded.ok) {
        return err(recorded.error);
      }

      return ok({
        document,
        version: recorded.value,
        versionNumber: 1,
        events,
        extractedText,
      });
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
   * Uploads a NEW content revision of an existing document (S17 version
   * history): extracts the new content FIRST (a bad revision must not
   * corrupt the current state), stores the bytes at a fresh key, adopts the
   * content through the domain service, appends the immutable version
   * record, and publishes the events once. The returned version number is
   * the new monotonic revision number (the index must be refreshed with it).
   */
  async uploadDocumentVersion(
    command: UploadDocumentVersionCommand,
  ): Promise<Result<UploadDocumentVersionResult, NexoraError>> {
    try {
      validateUploadDocumentVersion(command);
      const context = documentContext(
        command.actorId,
        command.correlationId,
        command.organizationId,
      );
      const document = await this.#requireVisibleDocument(
        DocumentId.from(command.documentId),
        command.organizationId,
        command.workspaceId,
      );

      // 1. Extract the new content BEFORE touching storage or the domain: a
      //    revision that cannot be processed must leave the document exactly
      //    as it was (validate → mutate).
      let extractedText: string;
      try {
        extractedText = await this.#extractor.extract(command.contentType, command.content);
      } catch (error) {
        return err(toNexoraError(error, 'New version could not be processed'));
      }

      // 2. The next monotonic version number (max history + 1).
      const versionNumber = await this.#documentsService.nextVersionNumber(document.id);
      const contentRef = ContentRef.forDocument(document.id, versionNumber);

      // 3. Store the bytes FIRST, then adopt the content through the domain
      //    service (validate → mutate → event). The domain event carries the
      //    true revision number (`versionNumber`), never the legacy counter.
      await this.#storage.store(contentRef.value, command.content);
      const adopted = await this.#documentsService.adoptNewContent(
        document.id,
        contentRef,
        versionNumber,
        context,
      );
      if (!adopted.ok) {
        await this.#storage.remove(contentRef.value);
        return err(adopted.error);
      }

      // 4. Append the immutable version record (history is write-once). If
      //    this fails the aggregate has ALREADY adopted the content — the
      //    stored bytes are now referenced by the document, so they must NOT
      //    be removed (that would point the document at missing content).
      //    The failure surfaces to the caller; a later upload reuses the
      //    number and overwrites the orphan key (self-healing).
      const recorded = await this.#documentsService.addVersion({
        documentId: document.id,
        organizationId: command.organizationId,
        workspaceId: command.workspaceId,
        version: versionNumber,
        contentRef: contentRef.value,
        contentType: command.contentType,
        createdBy: command.actorId,
      });
      if (!recorded.ok) {
        return err(recorded.error);
      }

      await this.#publisher.publish(adopted.value.events);
      return ok({
        document: adopted.value.document,
        version: recorded.value,
        versionNumber,
        extractedText,
        events: adopted.value.events,
      });
    } catch (error) {
      return err(toNexoraError(error, 'Unexpected document version upload error'));
    }
  }

  /**
   * Restores a historical version as a NEW current version (S17): the
   * historical bytes are loaded, copied forward into a fresh storage key, a
   * new immutable version record is appended, and the document aggregate
   * adopts the restored content. Historical records are NEVER mutated —
   * restore is copy-forward, and the new revision is re-indexed so retrieval
   * reflects the restored content.
   */
  async restoreDocumentVersion(
    command: RestoreDocumentVersionCommand,
  ): Promise<Result<RestoreDocumentVersionResult, NexoraError>> {
    try {
      const context = documentContext(
        command.actorId,
        command.correlationId,
        command.organizationId,
      );
      const document = await this.#requireVisibleDocument(
        DocumentId.from(command.documentId),
        command.organizationId,
        command.workspaceId,
      );

      // 1. The historical revision must exist and belong to the document
      //    (invalid (document, version) combinations resolve to NOT FOUND).
      const historical = await this.#documentsService.requireVersion(document.id, command.version);
      if (!historical.ok) {
        return err(historical.error);
      }
      const bytes = await this.#storage.load(historical.value.contentRef.value);
      if (bytes === undefined) {
        return err(
          new DocumentVersionNotFoundError({
            documentId: document.id,
            version: command.version,
          }),
        );
      }

      // 2. The restored content must be processable before any mutation.
      let extractedText: string;
      try {
        extractedText = await this.#extractor.extract(historical.value.contentType, bytes);
      } catch (error) {
        return err(toNexoraError(error, 'Restored version could not be processed'));
      }

      // 3. Copy the restored bytes FORWARD into a new revision (never
      //    rewriting the historical key).
      const versionNumber = await this.#documentsService.nextVersionNumber(document.id);
      const contentRef = ContentRef.forDocument(document.id, versionNumber);
      await this.#storage.store(contentRef.value, bytes);

      const restored = await this.#documentsService.restoreContent(
        document.id,
        contentRef,
        command.version,
        versionNumber,
        context,
      );
      if (!restored.ok) {
        await this.#storage.remove(contentRef.value);
        return err(restored.error);
      }

      // History is write-once; on failure the aggregate has ALREADY adopted
      // the restored content — the bytes stay (see uploadDocumentVersion).
      const recorded = await this.#documentsService.addVersion({
        documentId: document.id,
        organizationId: command.organizationId,
        workspaceId: command.workspaceId,
        version: versionNumber,
        contentRef: contentRef.value,
        contentType: historical.value.contentType,
        restoredFromVersion: command.version,
        createdBy: command.actorId,
      });
      if (!recorded.ok) {
        return err(recorded.error);
      }

      await this.#publisher.publish(restored.value.events);
      return ok({
        document: restored.value.document,
        version: recorded.value,
        versionNumber,
        restoredFromVersion: command.version,
        extractedText,
        events: restored.value.events,
      });
    } catch (error) {
      return err(toNexoraError(error, 'Unexpected document restore error'));
    }
  }

  /**
   * Lists the immutable version history of a visible document, oldest first
   * (workspace-scoped read).
   */
  async listDocumentVersions(
    organizationId: TenantId,
    workspaceId: WorkspaceId,
    documentId: string,
  ): Promise<Result<readonly DocumentVersionDto[], NexoraError>> {
    try {
      const document = await this.#requireVisibleDocument(
        DocumentId.from(documentId),
        organizationId,
        workspaceId,
      );
      const versions = await this.#documentsService.listVersions(document.id);
      if (!versions.ok) {
        return err(versions.error);
      }
      return ok(versions.value.map((version) => toDocumentVersionDto(version)));
    } catch (error) {
      return err(toNexoraError(error, 'Unexpected document version query error'));
    }
  }

  /**
   * Loads the binary content of a specific version of a visible document
   * (version content remains retrievable; invalid combinations resolve to
   * NOT FOUND).
   */
  async getDocumentVersionContent(
    organizationId: TenantId,
    workspaceId: WorkspaceId,
    documentId: string,
    version: number,
  ): Promise<Result<{ content: Buffer; contentType: string }, NexoraError>> {
    try {
      const document = await this.#requireVisibleDocument(
        DocumentId.from(documentId),
        organizationId,
        workspaceId,
      );
      // Archiving removes the document's content from storage; the retained
      // earlier versions must not stay downloadable behind an archived document.
      if (document.status.value === 'archived') {
        return err(new DocumentVersionNotFoundError({ documentId: document.id, version }));
      }
      const historical = await this.#documentsService.requireVersion(document.id, version);
      if (!historical.ok) {
        return err(historical.error);
      }
      const bytes = await this.#storage.load(historical.value.contentRef.value);
      if (bytes === undefined) {
        return err(new DocumentVersionNotFoundError({ documentId: document.id, version }));
      }
      return ok({ content: bytes, contentType: historical.value.contentType });
    } catch (error) {
      return err(toNexoraError(error, 'Unexpected document version content query error'));
    }
  }

  /**
   * Creates a document template in a workspace: stores the starter content
   * behind the storage port, persists the template aggregate, and publishes
   * the event once. The tenant + workspace are trusted scope — the model can
   * never choose identity.
   */
  async createDocumentTemplate(
    command: CreateDocumentTemplateCommand,
  ): Promise<Result<CreateDocumentTemplateResult, NexoraError>> {
    try {
      validateCreateDocumentTemplate(command);
      const context = documentContext(
        command.actorId,
        command.correlationId,
        command.organizationId,
      );

      // The storage key is opaque (never a business id). A failure to store
      // must never leave a template record pointing at nothing.
      const contentRef = ContentRef.create(`tpl/${DocumentTemplateId.create()}/v1`);
      await this.#storage.store(contentRef.value, command.content);

      const created = await this.#documentsService.createTemplate(
        {
          organizationId: command.organizationId,
          workspaceId: command.workspaceId,
          createdBy: command.actorId,
          name: command.name,
          description: command.description,
          contentType: command.contentType,
          contentRef: contentRef.value,
        },
        context,
      );
      if (!created.ok) {
        await this.#storage.remove(contentRef.value);
        return err(created.error);
      }

      await this.#publisher.publish(created.value.events);
      return ok({ template: created.value.template, events: created.value.events });
    } catch (error) {
      return err(toNexoraError(error, 'Unexpected document template creation error'));
    }
  }

  /**
   * Lists the ACTIVE templates of the trusted workspace (the template
   * picker read — archived and foreign-workspace templates never appear).
   */
  async listDocumentTemplates(
    organizationId: TenantId,
    workspaceId: WorkspaceId,
  ): Promise<Result<readonly DocumentTemplateDto[], never>> {
    const listed = await this.#documentsService.listActiveTemplatesByWorkspace(
      organizationId,
      workspaceId,
    );
    if (!listed.ok) {
      return err(listed.error);
    }
    return ok(listed.value.map((template) => toDocumentTemplateDto(template)));
  }

  /**
   * Archives a document template (`active` → `archived` — leaves the
   * picker). The template must belong to the trusted tenant + workspace.
   */
  async archiveDocumentTemplate(
    command: ArchiveDocumentTemplateCommand,
  ): Promise<Result<ArchiveDocumentTemplateResult, NexoraError>> {
    try {
      const context = documentContext(
        command.actorId,
        command.correlationId,
        command.organizationId,
      );
      await this.#requireVisibleTemplate(
        command.templateId,
        command.organizationId,
        command.workspaceId,
      );

      const archived = await this.#documentsService.archiveTemplate(command.templateId, context);
      if (!archived.ok) {
        return err(archived.error);
      }

      await this.#publisher.publish(archived.value.events);
      return ok({ template: archived.value.template, events: archived.value.events });
    } catch (error) {
      return err(toNexoraError(error, 'Unexpected document template archive error'));
    }
  }

  /**
   * Creates a document FROM a template (use-template flow): the template's
   * starter content becomes the new document's content through the SAME
   * upload pipeline as a manual upload (one business execution path), and
   * the document is indexed like any other. The template must belong to the
   * trusted tenant + workspace.
   */
  async createDocumentFromTemplate(
    command: CreateDocumentFromTemplateCommand,
  ): Promise<Result<CreateDocumentFromTemplateResult, NexoraError>> {
    try {
      const template = await this.#requireVisibleTemplate(
        command.templateId,
        command.organizationId,
        command.workspaceId,
      );
      const bytes = await this.#storage.load(template.contentRef.value);
      if (bytes === undefined) {
        return err(new DocumentTemplateNotFoundError({ templateId: command.templateId }));
      }

      const uploaded = await this.uploadDocument({
        organizationId: command.organizationId,
        workspaceId: command.workspaceId,
        uploaderId: command.actorId,
        title: command.title,
        contentType: template.contentType,
        content: bytes,
        correlationId: command.correlationId,
      });
      if (!uploaded.ok) {
        return err(uploaded.error);
      }
      return ok({
        document: uploaded.value.document,
        extractedText: uploaded.value.extractedText,
        events: uploaded.value.events,
      });
    } catch (error) {
      return err(toNexoraError(error, 'Unexpected create-from-template error'));
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
   * Loads a template and verifies it belongs to the trusted tenant +
   * workspace AND is active — the workspace-scope authorization boundary for
   * templates (a foreign or archived template id resolves to NOT FOUND,
   * never to another workspace's template).
   */
  async #requireVisibleTemplate(
    templateId: string,
    organizationId: TenantId,
    workspaceId: WorkspaceId,
  ): Promise<DocumentTemplate> {
    const found = await this.#documentsService.findTemplateById(templateId);
    if (!found.ok) {
      throw new DocumentTemplateNotFoundError({ templateId });
    }
    const template = found.value;
    if (template.organizationId !== organizationId || template.workspaceId !== workspaceId) {
      throw new DocumentTemplateNotFoundError({ templateId });
    }
    if (!template.isActive()) {
      throw new DocumentTemplateNotFoundError({ templateId });
    }
    return template;
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
