/**
 * @nexora/application-knowledge — KnowledgeApplicationService.
 *
 * The application layer orchestrator (BACKEND.md §4): coordinates the
 * Knowledge domain (sources + articles + categories, via the
 * {@link KnowledgeDomainService}) and the generic Search platform port
 * (permission-filtered lexical retrieval, BR-7). It contains no retrieval
 * logic of its own — the Search port is the single search implementation,
 * and the scope filter (trusted tenant + workspace) is applied there FIRST,
 * before any content is scored or returned.
 *
 * S18 adds the Knowledge Base lifecycle: articles (draft → published →
 * archived), flat workspace-scoped categories, and the article corpus
 * projection (indexArticle / removeArticleIndex). Articles are indexed
 * directly through the Search port with `kind = article` — there is no
 * document-shaped KnowledgeSource for them. The orchestration layer
 * (routes) indexes on publish, re-indexes on published edits, and removes on
 * archive — a draft is never indexed and an archived article never answers.
 *
 * The service never re-extracts or re-reads document content: indexing
 * consumes the text the Documents application already extracted. Scope is
 * TRUSTED server-side state — a foreign article/category id resolves to NOT
 * FOUND, never to another workspace's record.
 */

import type { TenantId, UserId, WorkspaceId } from '@nexora/contracts/common';
import type { EventEnvelope, EventPublisher } from '@nexora/shared/events';
import { toNexoraError, type NexoraError } from '@nexora/shared/errors';
import { err, ok, type Result } from '@nexora/shared/result';
import {
  KnowledgeArticleId,
  KnowledgeCategoryId,
  KnowledgeSource as KnowledgeSourceFactory,
  KnowledgeSourceId,
  KnowledgeArticleNotFoundError,
  KnowledgeCategoryNotFoundError,
  knowledgeIndexedEvent,
  knowledgeRemovedEvent,
  type KnowledgeArticle,
  type KnowledgeDomainService,
  type KnowledgeEventContext,
  type KnowledgeSource,
  type KnowledgeSourceRepository,
} from '@nexora/domain-knowledge';
import type { SearchIndexPort } from '@nexora/module-search';

import type {
  ArchiveArticleCommand,
  ArchiveArticleResult,
} from '../commands/archive-article.command.js';
import type {
  CreateArticleCommand,
  CreateArticleResult,
} from '../commands/create-article.command.js';
import type {
  CreateCategoryCommand,
  CreateCategoryResult,
} from '../commands/create-category.command.js';
import type {
  IndexDocumentCommand,
  IndexDocumentResult,
} from '../commands/index-document.command.js';
import type { IndexArticleCommand } from '../commands/index-article.command.js';
import type {
  PublishArticleCommand,
  PublishArticleResult,
} from '../commands/publish-article.command.js';
import type {
  UpdateArticleCommand,
  UpdateArticleResult,
} from '../commands/update-article.command.js';
import { toKnowledgeArticleDto, type KnowledgeArticleDto } from '../dto/knowledge-article.dto.js';
import {
  toKnowledgeCategoryDto,
  type KnowledgeCategoryDto,
} from '../dto/knowledge-category.dto.js';
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
import { validateCreateArticle } from '../validators/create-article.validator.js';
import { validateCreateCategory } from '../validators/create-category.validator.js';
import { validateRetrieveKnowledge } from '../validators/retrieve-knowledge.validator.js';
import { validateUpdateArticle } from '../validators/update-article.validator.js';

/** Dependencies of the {@link KnowledgeApplicationService}. */
export interface KnowledgeApplicationServiceDependencies {
  /** The knowledge source persistence port. */
  sources: KnowledgeSourceRepository;
  /** The generic permission-filtered search index (the ONE search implementation). */
  searchIndex: SearchIndexPort;
  /** Publishes domain events to the platform event stream. */
  publisher: EventPublisher;
  /** The knowledge lifecycle domain service (articles + categories, S18). */
  knowledgeService: KnowledgeDomainService;
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

/** Removes a published article's corpus entry within a scope. */
export interface RemoveArticleIndexCommand {
  /** The trusted tenant id. */
  tenantId: TenantId;
  /** The trusted workspace id. */
  workspaceId: WorkspaceId;
  /** The article id to remove from the index. */
  articleId: string;
}

/**
 * The knowledge application service. All methods return a `Result` so
 * expected failures are explicit values.
 */
export class KnowledgeApplicationService {
  readonly #sources: KnowledgeSourceRepository;
  readonly #searchIndex: SearchIndexPort;
  readonly #publisher: EventPublisher;
  readonly #knowledgeService: KnowledgeDomainService;

  constructor(dependencies: KnowledgeApplicationServiceDependencies) {
    this.#sources = dependencies.sources;
    this.#searchIndex = dependencies.searchIndex;
    this.#publisher = dependencies.publisher;
    this.#knowledgeService = dependencies.knowledgeService;
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
   * scoring — unauthorized documents AND unpublished/archived articles never
   * reach the caller, and therefore never reach the AI model. Citations
   * reference ONLY authorized sources and carry `kind` + `version` (AIR
   * §9.3: source + version + passage).
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
        kind: entry.kind,
        version: entry.version,
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

  // --- S18: knowledge base articles ---------------------------------------

  /**
   * Creates a knowledge article as a DRAFT (never indexed). The optional
   * category must belong to the trusted tenant + workspace and be active.
   */
  async createArticle(
    command: CreateArticleCommand,
  ): Promise<Result<CreateArticleResult, NexoraError>> {
    try {
      validateCreateArticle(command);
      const context = knowledgeContext(command.actorId, command.correlationId, command.tenantId);
      await this.#requireVisibleCategory(command.categoryId, command.tenantId, command.workspaceId);

      const created = await this.#knowledgeService.createArticle(
        {
          tenantId: command.tenantId,
          workspaceId: command.workspaceId,
          title: command.title,
          body: command.body,
          categoryId: command.categoryId,
          author: command.actorId,
        },
        context,
      );
      if (!created.ok) {
        return err(created.error);
      }
      await this.#publisher.publish(created.value.events);
      return ok({ article: created.value.article, events: created.value.events });
    } catch (error) {
      return err(toNexoraError(error, 'Unexpected knowledge article creation error'));
    }
  }

  /**
   * Updates an article's content (draft + published; archived is terminal).
   * The content version bumps monotonically; the orchestration layer
   * re-indexes a PUBLISHED article so the corpus serves the new version.
   */
  async updateArticle(
    command: UpdateArticleCommand,
  ): Promise<Result<UpdateArticleResult, NexoraError>> {
    try {
      validateUpdateArticle(command);
      const context = knowledgeContext(command.actorId, command.correlationId, command.tenantId);
      const article = await this.#requireVisibleArticle(
        command.articleId,
        command.tenantId,
        command.workspaceId,
      );
      await this.#requireVisibleCategory(command.categoryId, command.tenantId, command.workspaceId);

      const updated = await this.#knowledgeService.updateArticle(
        article.id,
        { title: command.title, body: command.body, categoryId: command.categoryId },
        context,
      );
      if (!updated.ok) {
        return err(updated.error);
      }
      await this.#publisher.publish(updated.value.events);
      return ok({ article: updated.value.article, events: updated.value.events });
    } catch (error) {
      return err(toNexoraError(error, 'Unexpected knowledge article update error'));
    }
  }

  /**
   * Publishes an article (`draft` → `published`). The orchestration layer
   * indexes the article afterwards — publication is the freshness gate.
   */
  async publishArticle(
    command: PublishArticleCommand,
  ): Promise<Result<PublishArticleResult, NexoraError>> {
    try {
      const context = knowledgeContext(command.actorId, command.correlationId, command.tenantId);
      const article = await this.#requireVisibleArticle(
        command.articleId,
        command.tenantId,
        command.workspaceId,
      );
      const published = await this.#knowledgeService.publishArticle(article.id, context);
      if (!published.ok) {
        return err(published.error);
      }
      await this.#publisher.publish(published.value.events);
      return ok({ article: published.value.article, events: published.value.events });
    } catch (error) {
      return err(toNexoraError(error, 'Unexpected knowledge article publish error'));
    }
  }

  /**
   * Archives an article (terminal). The orchestration layer removes its
   * corpus entry afterwards — an archived article can never answer.
   */
  async archiveArticle(
    command: ArchiveArticleCommand,
  ): Promise<Result<ArchiveArticleResult, NexoraError>> {
    try {
      const context = knowledgeContext(command.actorId, command.correlationId, command.tenantId);
      const article = await this.#requireVisibleArticle(
        command.articleId,
        command.tenantId,
        command.workspaceId,
      );
      const archived = await this.#knowledgeService.archiveArticle(article.id, context);
      if (!archived.ok) {
        return err(archived.error);
      }
      await this.#publisher.publish(archived.value.events);
      return ok({ article: archived.value.article, events: archived.value.events });
    } catch (error) {
      return err(toNexoraError(error, 'Unexpected knowledge article archive error'));
    }
  }

  /** Reads one article within the trusted scope (NOT FOUND otherwise). */
  async getArticle(
    tenantId: TenantId,
    workspaceId: WorkspaceId,
    articleId: string,
  ): Promise<Result<KnowledgeArticleDto, NexoraError>> {
    try {
      const article = await this.#requireVisibleArticle(articleId, tenantId, workspaceId);
      return ok(toKnowledgeArticleDto(article));
    } catch (error) {
      return err(toNexoraError(error, 'Unexpected knowledge article query error'));
    }
  }

  /** Lists the articles of the trusted workspace, newest first. */
  async listArticlesByWorkspace(
    tenantId: TenantId,
    workspaceId: WorkspaceId,
  ): Promise<Result<readonly KnowledgeArticleDto[], never>> {
    const listed = await this.#knowledgeService.listArticlesByWorkspace(tenantId, workspaceId);
    if (!listed.ok) {
      return err(listed.error);
    }
    return ok(listed.value.map((article) => toKnowledgeArticleDto(article)));
  }

  // --- S18: categories ------------------------------------------------------

  /** Creates a flat, workspace-scoped category. */
  async createCategory(
    command: CreateCategoryCommand,
  ): Promise<Result<CreateCategoryResult, NexoraError>> {
    try {
      validateCreateCategory(command);
      const context = knowledgeContext(command.actorId, command.correlationId, command.tenantId);
      const created = await this.#knowledgeService.createCategory(
        {
          tenantId: command.tenantId,
          workspaceId: command.workspaceId,
          name: command.name,
        },
        context,
      );
      if (!created.ok) {
        return err(created.error);
      }
      await this.#publisher.publish(created.value.events);
      return ok({ category: created.value.category, events: created.value.events });
    } catch (error) {
      return err(toNexoraError(error, 'Unexpected knowledge category creation error'));
    }
  }

  /** Lists the categories of the trusted workspace. */
  async listCategoriesByWorkspace(
    tenantId: TenantId,
    workspaceId: WorkspaceId,
  ): Promise<Result<readonly KnowledgeCategoryDto[], never>> {
    const listed = await this.#knowledgeService.listCategoriesByWorkspace(tenantId, workspaceId);
    if (!listed.ok) {
      return err(listed.error);
    }
    return ok(listed.value.map((category) => toKnowledgeCategoryDto(category)));
  }

  // --- S18: article corpus projection ----------------------------------------

  /**
   * Indexes a PUBLISHED article into the search corpus: the entry carries
   * `kind = article`, `scopeId = articleId`, and `version = contentVersion`,
   * and the entry id IS the article id — stable across re-indexes so a
   * published edit REPLACES the corpus entry (a stale article never answers).
   * No document-shaped KnowledgeSource is created for articles.
   */
  async indexArticle(
    command: IndexArticleCommand,
  ): Promise<Result<{ indexed: boolean }, NexoraError>> {
    try {
      await this.#searchIndex.put({
        id: command.articleId,
        tenantId: command.tenantId,
        workspaceId: command.workspaceId,
        scopeId: command.articleId,
        kind: 'article',
        title: command.title,
        text: command.text,
        version: command.version,
        indexedAt: new Date().toISOString(),
      });
      return ok({ indexed: true });
    } catch (error) {
      return err(toNexoraError(error, 'Unexpected knowledge article index error'));
    }
  }

  /**
   * Removes an article from the search corpus (archived articles must never
   * answer retrieval).
   */
  async removeArticleIndex(
    command: RemoveArticleIndexCommand,
  ): Promise<Result<{ removed: boolean }, NexoraError>> {
    try {
      await this.#searchIndex.removeByScope(command.articleId, command.tenantId);
      return ok({ removed: true });
    } catch (error) {
      return err(toNexoraError(error, 'Unexpected knowledge article removal error'));
    }
  }

  /**
   * Loads an article and verifies it belongs to the trusted tenant +
   * workspace — the workspace-scope authorization boundary (a foreign or
   * forged article id resolves to NOT FOUND, never to another workspace's
   * record).
   */
  async #requireVisibleArticle(
    articleId: string,
    tenantId: TenantId,
    workspaceId: WorkspaceId,
  ): Promise<KnowledgeArticle> {
    const found = await this.#knowledgeService.findArticleById(KnowledgeArticleId.from(articleId));
    if (!found.ok || found.value.tenantId !== tenantId || found.value.workspaceId !== workspaceId) {
      throw new KnowledgeArticleNotFoundError({ articleId });
    }
    return found.value;
  }

  /**
   * Verifies an optional category belongs to the trusted tenant + workspace
   * AND is active — a foreign, archived, or forged category id resolves to
   * NOT FOUND.
   */
  async #requireVisibleCategory(
    categoryId: string | undefined,
    tenantId: TenantId,
    workspaceId: WorkspaceId,
  ): Promise<void> {
    if (categoryId === undefined || categoryId.trim().length === 0) {
      return;
    }
    const found = await this.#knowledgeService.findCategoryById(
      KnowledgeCategoryId.from(categoryId),
    );
    if (
      !found.ok ||
      found.value.tenantId !== tenantId ||
      found.value.workspaceId !== workspaceId ||
      !found.value.isActive()
    ) {
      throw new KnowledgeCategoryNotFoundError({ categoryId });
    }
  }
}

/** Builds a knowledge event context (tenant known to caller). */
function knowledgeContext(
  actorId: UserId,
  correlationId: string,
  organizationId: TenantId,
): KnowledgeEventContext {
  return { actor: { kind: 'user', id: actorId }, correlationId, organizationId };
}
