/**
 * @nexora/application-knowledge — KnowledgeApplicationService.
 *
 * The application layer orchestrator (BACKEND.md §4): coordinates the
 * Knowledge domain (sources) and the generic Search platform port
 * (permission-filtered lexical retrieval, BR-7). It contains no retrieval
 * logic of its own — the Search port is the single search implementation,
 * and the scope filter (trusted tenant + workspace) is applied there FIRST,
 * before any content is scored or returned.
 *
 * The service never re-extracts or re-reads document content: indexing
 * consumes the text the Documents application already extracted (the
 * orchestration layer passes it across the boundary).
 */

import type { TenantId, WorkspaceId } from '@nexora/contracts/common';
import type { EventEnvelope, EventPublisher } from '@nexora/shared/events';
import { toNexoraError, type NexoraError } from '@nexora/shared/errors';
import { err, ok, type Result } from '@nexora/shared/result';
import {
  KnowledgeSource as KnowledgeSourceFactory,
  KnowledgeSourceId,
  knowledgeIndexedEvent,
  knowledgeRemovedEvent,
  type KnowledgeSource,
  type KnowledgeSourceRepository,
} from '@nexora/domain-knowledge';
import type { SearchIndexPort } from '@nexora/module-search';

import type {
  IndexDocumentCommand,
  IndexDocumentResult,
} from '../commands/index-document.command.js';
import {
  buildSnippet,
  type KnowledgeReferenceDto,
  type RetrieveKnowledgeResult,
} from '../dto/knowledge-reference.dto.js';
import {
  KNOWLEDGE_RETRIEVAL_LIMIT_DEFAULT,
  KNOWLEDGE_RETRIEVAL_LIMIT_MAX,
  type RetrieveKnowledgeQuery,
} from '../queries/retrieve-knowledge.query.js';
import { validateRetrieveKnowledge } from '../validators/retrieve-knowledge.validator.js';

/** Dependencies of the {@link KnowledgeApplicationService}. */
export interface KnowledgeApplicationServiceDependencies {
  /** The knowledge source persistence port. */
  sources: KnowledgeSourceRepository;
  /** The generic permission-filtered search index (the ONE search implementation). */
  searchIndex: SearchIndexPort;
  /** Publishes domain events to the platform event stream. */
  publisher: EventPublisher;
}

/** Removes a document's indexed source within a scope. */
export interface RemoveDocumentIndexCommand {
  /** The trusted tenant id. */
  tenantId: TenantId;
  /** The trusted workspace id. */
  workspaceId: WorkspaceId;
  /** The document id to remove from the index. */
  documentId: string;
  /** The actor + correlation context. */
  context: { actorId: string; correlationId: string };
}

/**
 * The knowledge application service. All methods return a `Result` so
 * expected failures are explicit values.
 */
export class KnowledgeApplicationService {
  readonly #sources: KnowledgeSourceRepository;
  readonly #searchIndex: SearchIndexPort;
  readonly #publisher: EventPublisher;

  constructor(dependencies: KnowledgeApplicationServiceDependencies) {
    this.#sources = dependencies.sources;
    this.#searchIndex = dependencies.searchIndex;
    this.#publisher = dependencies.publisher;
  }

  /**
   * Indexes a document's latest content version: persists the source,
   * puts the entry into the search index (replacing any older version — a
   * stale index entry never answers), and publishes `knowledge.indexed`
   * once.
   */
  async indexDocument(
    command: IndexDocumentCommand,
  ): Promise<Result<IndexDocumentResult, NexoraError>> {
    try {
      // One source per document: re-indexing a document version UPSERTS the
      // existing source (reusing its id) so the search index replaces the
      // entry — a stale version can never remain answerable.
      const existing = await this.#sources.findByDocument(
        command.tenantId,
        command.workspaceId,
        command.documentId,
      );
      const source =
        existing === undefined
          ? KnowledgeSourceFactory.create({
              tenantId: command.tenantId,
              workspaceId: command.workspaceId,
              documentId: command.documentId,
              title: command.title,
              text: command.text,
              version: command.version,
            })
          : KnowledgeSourceFactory.hydrate({
              ...KnowledgeSourceFactory.snapshot(existing),
              title: command.title.trim(),
              text: command.text.trim(),
              version: command.version,
              indexedAt: new Date().toISOString(),
            });

      await this.#sources.save(source);
      await this.#searchIndex.put({
        id: source.id,
        tenantId: source.tenantId,
        workspaceId: source.workspaceId,
        scopeId: source.documentId,
        kind: 'document',
        title: source.title,
        text: source.text,
        version: source.version,
        indexedAt: source.indexedAt,
      });

      const events: EventEnvelope[] = [
        knowledgeIndexedEvent(
          {
            actor: { kind: 'user', id: command.context.actorId },
            correlationId: command.context.correlationId,
            organizationId: command.tenantId,
          },
          {
            sourceId: source.id,
            documentId: source.documentId,
            tenantId: source.tenantId,
            workspaceId: source.workspaceId,
            version: source.version,
          },
        ),
      ];
      await this.#publisher.publish(events);

      return ok({ source, events });
    } catch (error) {
      return err(toNexoraError(error, 'Unexpected knowledge index error'));
    }
  }

  /**
   * Removes a document from the index (archived/deleted): the search entry
   * leaves the projection AND the persisted source is removed — stale
   * entries can never answer. Publishes `knowledge.removed`.
   */
  async removeDocument(
    command: RemoveDocumentIndexCommand,
  ): Promise<Result<{ events: readonly EventEnvelope[] }, NexoraError>> {
    try {
      await this.#searchIndex.removeByScope(command.documentId, command.tenantId);
      await this.#sources.removeByDocument(
        command.tenantId,
        command.workspaceId,
        command.documentId,
      );
      const events: EventEnvelope[] = [
        knowledgeRemovedEvent(
          {
            actor: { kind: 'user', id: command.context.actorId },
            correlationId: command.context.correlationId,
            organizationId: command.tenantId,
          },
          {
            documentId: command.documentId,
            tenantId: command.tenantId,
            workspaceId: command.workspaceId,
          },
        ),
      ];
      await this.#publisher.publish(events);
      return ok({ events });
    } catch (error) {
      return err(toNexoraError(error, 'Unexpected knowledge removal error'));
    }
  }

  /**
   * Retrieves authorized references for a question (BR-7): the scope filter
   * (trusted tenant + workspace) is applied by the search index BEFORE any
   * scoring — unauthorized documents never reach the caller, and therefore
   * never reach the AI model. Citations reference ONLY authorized sources.
   */
  async retrieve(
    query: RetrieveKnowledgeQuery,
  ): Promise<Result<RetrieveKnowledgeResult, NexoraError>> {
    try {
      validateRetrieveKnowledge(query);
      const limit = Math.min(
        Math.max(1, Math.trunc(query.limit ?? KNOWLEDGE_RETRIEVAL_LIMIT_DEFAULT)),
        KNOWLEDGE_RETRIEVAL_LIMIT_MAX,
      );
      const entries = await this.#searchIndex.query({
        tenantId: query.tenantId,
        workspaceId: query.workspaceId,
        query: query.query,
        limit,
      });
      const references: KnowledgeReferenceDto[] = entries.map((entry) => ({
        sourceId: entry.id,
        documentId: entry.scopeId,
        title: entry.title,
        workspaceId: entry.workspaceId,
        snippet: buildSnippet(entry.text, query.query),
      }));
      return ok({ references });
    } catch (error) {
      return err(toNexoraError(error, 'Unexpected knowledge retrieval error'));
    }
  }

  /** Loads a source by id (test/observability aid). */
  async findSource(sourceId: string): Promise<KnowledgeSource | undefined> {
    return this.#sources.findById(KnowledgeSourceId.from(sourceId));
  }
}
