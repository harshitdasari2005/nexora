/**
 * @nexora/domain-knowledge — KnowledgeDomainService.
 *
 * Orchestrates the {@link KnowledgeArticle} and {@link KnowledgeCategory}
 * lifecycle (S18 Knowledge Base): create/update/publish/archive and the
 * scope-bound reads. Owns the use-case workflows that span the aggregates
 * and their repositories; the aggregates enforce their own invariants
 * (validate → mutate → event). All methods return a `Result` so expected
 * failures are explicit values.
 */

import type { Result } from '@nexora/shared/result';
import { err, ok } from '@nexora/shared/result';
import type { TenantId, UserId, WorkspaceId } from '@nexora/contracts/common';
import type { EventEnvelope } from '@nexora/shared/events';

import { KnowledgeArticle } from '../entities/knowledge-article.js';
import { KnowledgeCategory } from '../entities/knowledge-category.js';
import type { KnowledgeEventContext } from '../events/index.js';
import {
  KnowledgeArticleNotFoundError,
  KnowledgeCategoryNameAlreadyExistsError,
  KnowledgeCategoryNotFoundError,
  toKnowledgeError,
  type KnowledgeDomainError,
} from '../errors/index.js';
import type {
  KnowledgeArticleRepository,
  KnowledgeCategoryRepository,
} from '../repositories/index.js';
import type { KnowledgeArticleId } from '../value-objects/knowledge-article-id.js';
import type { KnowledgeCategoryId } from '../value-objects/knowledge-category-id.js';
import { KnowledgeCategoryId as KnowledgeCategoryIdFactory } from '../value-objects/knowledge-category-id.js';

/** The outcome of an article command: the aggregate plus emitted events. */
export interface ArticleCommandResult {
  /** The mutated aggregate. */
  article: KnowledgeArticle;
  /** Domain events emitted by the operation. */
  events: readonly EventEnvelope[];
}

/** The outcome of a category command: the aggregate plus emitted events. */
export interface CategoryCommandResult {
  /** The mutated aggregate. */
  category: KnowledgeCategory;
  /** Domain events emitted by the operation. */
  events: readonly EventEnvelope[];
}

/** Dependencies of the {@link KnowledgeDomainService}. */
export interface KnowledgeDomainServiceDependencies {
  /** Article persistence. */
  articles: KnowledgeArticleRepository;
  /** Category persistence. */
  categories: KnowledgeCategoryRepository;
}

/**
 * The knowledge lifecycle use-case service (articles + categories).
 */
export class KnowledgeDomainService {
  readonly #articles: KnowledgeArticleRepository;
  readonly #categories: KnowledgeCategoryRepository;

  constructor(dependencies: KnowledgeDomainServiceDependencies) {
    this.#articles = dependencies.articles;
    this.#categories = dependencies.categories;
  }

  /** Creates an article as a `draft` (never indexed until published). */
  async createArticle(
    input: {
      tenantId: TenantId;
      workspaceId: WorkspaceId;
      title: string;
      body: string;
      categoryId?: string;
      author: UserId;
    },
    context: KnowledgeEventContext,
  ): Promise<Result<ArticleCommandResult, KnowledgeDomainError>> {
    try {
      const categoryId =
        input.categoryId === undefined || input.categoryId.trim().length === 0
          ? undefined
          : KnowledgeCategoryIdFactory.from(input.categoryId.trim());
      const article = KnowledgeArticle.create(
        {
          tenantId: input.tenantId,
          workspaceId: input.workspaceId,
          title: input.title,
          body: input.body,
          categoryId,
          author: input.author,
        },
        context,
      );
      await this.#articles.save(article);
      return ok({ article, events: article.pullDomainEvents() });
    } catch (error) {
      return err(toKnowledgeError(error));
    }
  }

  /** Updates an article's content (draft + published; archived is terminal). */
  async updateArticle(
    articleId: KnowledgeArticleId,
    input: { title: string; body: string; categoryId?: string },
    context: KnowledgeEventContext,
  ): Promise<Result<ArticleCommandResult, KnowledgeDomainError>> {
    try {
      const article = await this.#requireArticle(articleId);
      article.updateContent(input, context);
      await this.#articles.save(article);
      return ok({ article, events: article.pullDomainEvents() });
    } catch (error) {
      return err(toKnowledgeError(error));
    }
  }

  /** Publishes an article (`draft` → `published` — retrievable now). */
  async publishArticle(
    articleId: KnowledgeArticleId,
    context: KnowledgeEventContext,
  ): Promise<Result<ArticleCommandResult, KnowledgeDomainError>> {
    try {
      const article = await this.#requireArticle(articleId);
      article.publish(context);
      await this.#articles.save(article);
      return ok({ article, events: article.pullDomainEvents() });
    } catch (error) {
      return err(toKnowledgeError(error));
    }
  }

  /** Archives an article (terminal; removed from the search corpus). */
  async archiveArticle(
    articleId: KnowledgeArticleId,
    context: KnowledgeEventContext,
  ): Promise<Result<ArticleCommandResult, KnowledgeDomainError>> {
    try {
      const article = await this.#requireArticle(articleId);
      article.archive(context);
      await this.#articles.save(article);
      return ok({ article, events: article.pullDomainEvents() });
    } catch (error) {
      return err(toKnowledgeError(error));
    }
  }

  /** Finds an article by id, or a {@link KnowledgeArticleNotFoundError}. */
  async findArticleById(
    articleId: KnowledgeArticleId,
  ): Promise<Result<KnowledgeArticle, KnowledgeArticleNotFoundError>> {
    const article = await this.#articles.findById(articleId);
    if (article === undefined) {
      return err(new KnowledgeArticleNotFoundError({ articleId }));
    }
    return ok(article);
  }

  /** Lists the articles of a workspace, newest first (scope-bound read). */
  async listArticlesByWorkspace(
    tenantId: TenantId,
    workspaceId: WorkspaceId,
  ): Promise<Result<readonly KnowledgeArticle[], never>> {
    return ok(await this.#articles.listByWorkspace(tenantId, workspaceId));
  }

  /** Creates a category (`active`) in a workspace. */
  async createCategory(
    input: { tenantId: TenantId; workspaceId: WorkspaceId; name: string },
    context: KnowledgeEventContext,
  ): Promise<Result<CategoryCommandResult, KnowledgeDomainError>> {
    try {
      // Name uniqueness is enforced in the scope BEFORE save — the same
      // pre-check pattern as the organization slug (never leak a raw
      // unique-violation as an INTERNAL_ERROR).
      if (await this.#categories.existsByName(input.tenantId, input.workspaceId, input.name)) {
        throw new KnowledgeCategoryNameAlreadyExistsError({
          tenantId: input.tenantId,
          workspaceId: input.workspaceId,
          name: input.name,
        });
      }
      const category = KnowledgeCategory.create(input, context);
      await this.#categories.save(category);
      return ok({ category, events: category.pullDomainEvents() });
    } catch (error) {
      return err(toKnowledgeError(error));
    }
  }

  /** Finds a category by id, or a {@link KnowledgeCategoryNotFoundError}. */
  async findCategoryById(
    categoryId: KnowledgeCategoryId,
  ): Promise<Result<KnowledgeCategory, KnowledgeCategoryNotFoundError>> {
    const category = await this.#categories.findById(categoryId);
    if (category === undefined) {
      return err(new KnowledgeCategoryNotFoundError({ categoryId }));
    }
    return ok(category);
  }

  /** Lists the categories of a workspace, newest first (scope-bound read). */
  async listCategoriesByWorkspace(
    tenantId: TenantId,
    workspaceId: WorkspaceId,
  ): Promise<Result<readonly KnowledgeCategory[], never>> {
    return ok(await this.#categories.listByWorkspace(tenantId, workspaceId));
  }

  /** Loads an article or throws {@link KnowledgeArticleNotFoundError}. */
  async #requireArticle(articleId: KnowledgeArticleId): Promise<KnowledgeArticle> {
    const article = await this.#articles.findById(articleId);
    if (article === undefined) {
      throw new KnowledgeArticleNotFoundError({ articleId });
    }
    return article;
  }
}
