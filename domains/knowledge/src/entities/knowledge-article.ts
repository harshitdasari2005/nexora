/**
 * @nexora/domain-knowledge — KnowledgeArticle aggregate.
 *
 * A knowledge base article (S18 Knowledge Base): authored content owned by
 * exactly one tenant + one workspace (immutable scope). The article is the
 * AUTHORITATIVE source of its own content — the indexed corpus entry is a
 * projection of the PUBLISHED article only (drafts are never indexed).
 *
 * Lifecycle (validate → mutate → emit event):
 *
 *   draft → published → archived (terminal)
 *
 * - Only PUBLISHED articles are indexed and therefore retrievable (BR-7).
 * - Editing bumps the monotonic `contentVersion` (a counter, NOT a second
 *   document-version system — article history snapshots are deferred); the
 *   search corpus is refreshed with the new version on every published edit
 *   so a stale article never answers.
 * - `archived` is terminal in v1; archiving removes the article from the
 *   search corpus.
 *
 * The aggregate holds content metadata only and records domain events; no
 * partial mutation on validation failure.
 */

import { nowIso } from '@nexora/shared/time';
import type { EventEnvelope } from '@nexora/shared/events';
import type { TenantId, UserId, WorkspaceId } from '@nexora/contracts/common';

import {
  articleArchivedEvent,
  articleCreatedEvent,
  articlePublishedEvent,
  articleUpdatedEvent,
  type KnowledgeEventContext,
} from '../events/index.js';
import { InvalidKnowledgeValueError } from '../errors/index.js';
import type { KnowledgeArticleId } from '../value-objects/knowledge-article-id.js';
import { KnowledgeArticleId as KnowledgeArticleIdFactory } from '../value-objects/knowledge-article-id.js';
import { KnowledgeArticleStatus } from '../value-objects/knowledge-article-status.js';
import type { KnowledgeCategoryId } from '../value-objects/knowledge-category-id.js';
import { KnowledgeCategoryId as KnowledgeCategoryIdFactory } from '../value-objects/knowledge-category-id.js';

/** The maximum article title length. */
export const KNOWLEDGE_ARTICLE_TITLE_MAX_LENGTH = 200;
/** The maximum article body length (bounds the indexed corpus entry). */
export const KNOWLEDGE_ARTICLE_BODY_MAX_LENGTH = 100_000;

/** Input for creating a new {@link KnowledgeArticle}. */
export interface CreateKnowledgeArticleInput {
  /** The owning organization (tenant) id — immutable scope. */
  tenantId: TenantId;
  /** The owning workspace id — immutable scope. */
  workspaceId: WorkspaceId;
  /** The article title (validated). */
  title: string;
  /** The article body (validated). */
  body: string;
  /** The optional owning category id (flat, workspace-scoped, one per article). */
  categoryId?: KnowledgeCategoryId;
  /** The authoring user id. */
  author: UserId;
}

/** A persistence snapshot of the {@link KnowledgeArticle}. */
export interface KnowledgeArticleSnapshot {
  /** The article id. */
  id: KnowledgeArticleId;
  /** The owning organization (tenant) id. */
  tenantId: TenantId;
  /** The owning workspace id. */
  workspaceId: WorkspaceId;
  /** The article title. */
  title: string;
  /** The article body. */
  body: string;
  /** The optional owning category id. */
  categoryId?: KnowledgeCategoryId;
  /** The lifecycle status value. */
  status: string;
  /** The monotonic content version (bumped on every content update). */
  contentVersion: number;
  /** The authoring user id. */
  author: UserId;
  /** ISO-8601 UTC creation time. */
  createdAt: string;
  /** ISO-8601 UTC last mutation time. */
  updatedAt: string;
  /** Monotonic version for optimistic concurrency. */
  version: number;
}

/**
 * The {@link KnowledgeArticle} aggregate root. Use {@link KnowledgeArticle.create}
 * to construct; mutate only through aggregate methods so invariants stay
 * protected.
 */
export class KnowledgeArticle {
  // Not `readonly`: reassigned only by `hydrate` (reconstitution) and by
  // `updateContent` (a new content revision replaces title/body/category).
  #id: KnowledgeArticleId;
  readonly #tenantId: TenantId;
  readonly #workspaceId: WorkspaceId;
  #title: string;
  #body: string;
  #categoryId?: KnowledgeCategoryId;
  #status: KnowledgeArticleStatus;
  #contentVersion: number;
  readonly #author: UserId;
  readonly #createdAt: string;
  #updatedAt: string;
  #version: number;
  readonly #events: EventEnvelope[] = [];

  private constructor(input: CreateKnowledgeArticleInput, createdAt: string) {
    this.#id = KnowledgeArticleIdFactory.create();
    this.#tenantId = input.tenantId;
    this.#workspaceId = input.workspaceId;
    this.#title = normalizeTitle(input.title);
    this.#body = normalizeBody(input.body);
    this.#categoryId = input.categoryId;
    this.#status = KnowledgeArticleStatus.draft();
    this.#contentVersion = 1;
    this.#author = input.author;
    this.#createdAt = createdAt;
    this.#updatedAt = createdAt;
    this.#version = 1;
  }

  /**
   * Creates a new {@link KnowledgeArticle} in `draft` status (never indexed)
   * and records a {@link articleCreatedEvent}.
   */
  static create(
    input: CreateKnowledgeArticleInput,
    context: KnowledgeEventContext,
    now = nowIso(),
  ): KnowledgeArticle {
    const article = new KnowledgeArticle(input, now);
    article.#events.push(
      articleCreatedEvent(context, {
        articleId: article.#id,
        tenantId: article.#tenantId,
        workspaceId: article.#workspaceId,
        title: article.#title,
        status: article.#status.value,
      }),
    );
    return article;
  }

  /** The article id. */
  get id(): KnowledgeArticleId {
    return this.#id;
  }

  /** The owning organization (tenant) id — immutable scope. */
  get tenantId(): TenantId {
    return this.#tenantId;
  }

  /** The owning workspace id — immutable scope. */
  get workspaceId(): WorkspaceId {
    return this.#workspaceId;
  }

  /** The article title. */
  get title(): string {
    return this.#title;
  }

  /** The article body. */
  get body(): string {
    return this.#body;
  }

  /** The optional owning category id. */
  get categoryId(): KnowledgeCategoryId | undefined {
    return this.#categoryId;
  }

  /** The lifecycle status. */
  get status(): KnowledgeArticleStatus {
    return this.#status;
  }

  /** The monotonic content version (bumped on every content update). */
  get contentVersion(): number {
    return this.#contentVersion;
  }

  /** The authoring user id. */
  get author(): UserId {
    return this.#author;
  }

  /** ISO-8601 UTC creation time. */
  get createdAt(): string {
    return this.#createdAt;
  }

  /** ISO-8601 UTC time of the last mutation. */
  get updatedAt(): string {
    return this.#updatedAt;
  }

  /** Monotonic version for optimistic concurrency. */
  get version(): number {
    return this.#version;
  }

  /** Whether the article is retrievable (published and not archived). */
  isRetrievable(): boolean {
    return this.#status.isPublished();
  }

  /**
   * Updates the article content (title/body/category): allowed on `draft`
   * and `published`; `archived` is terminal. The content version is bumped —
   * the search corpus is refreshed with the new version when the article is
   * published (index freshness). Records an {@link articleUpdatedEvent}.
   *
   * @throws {InvalidKnowledgeValueError} when the article is archived or the
   * input is invalid.
   */
  updateContent(
    input: { title: string; body: string; categoryId?: string },
    context: KnowledgeEventContext,
    now = nowIso(),
  ): void {
    this.#assertUpdatable();
    const title = normalizeTitle(input.title);
    const body = normalizeBody(input.body);
    const categoryId =
      input.categoryId === undefined || input.categoryId.trim().length === 0
        ? undefined
        : KnowledgeCategoryIdFactory.from(input.categoryId.trim());
    this.#title = title;
    this.#body = body;
    this.#categoryId = categoryId;
    this.#contentVersion += 1;
    this.#bump(now);
    this.#events.push(
      articleUpdatedEvent(context, {
        articleId: this.#id,
        tenantId: this.#tenantId,
        workspaceId: this.#workspaceId,
        title: this.#title,
        status: this.#status.value,
        version: this.#contentVersion,
      }),
    );
  }

  /**
   * Publishes the article (`draft` → `published`): the content becomes
   * indexable and therefore retrievable. Records an {@link articlePublishedEvent}.
   *
   * @throws {InvalidKnowledgeValueError} when the transition is not allowed.
   */
  publish(context: KnowledgeEventContext, now = nowIso()): void {
    this.#status = this.#status.transitionTo('published');
    this.#bump(now);
    this.#events.push(
      articlePublishedEvent(context, {
        articleId: this.#id,
        tenantId: this.#tenantId,
        workspaceId: this.#workspaceId,
        version: this.#contentVersion,
      }),
    );
  }

  /**
   * Archives the article (`draft`/`published` → `archived`, terminal): the
   * article leaves the search corpus. Records an {@link articleArchivedEvent}.
   *
   * @throws {InvalidKnowledgeValueError} when the article is already archived.
   */
  archive(context: KnowledgeEventContext, now = nowIso()): void {
    this.#status = this.#status.transitionTo('archived');
    this.#bump(now);
    this.#events.push(
      articleArchivedEvent(context, {
        articleId: this.#id,
        tenantId: this.#tenantId,
        workspaceId: this.#workspaceId,
      }),
    );
  }

  /** Produces a persistence snapshot of the article. */
  static snapshot(article: KnowledgeArticle): KnowledgeArticleSnapshot {
    return {
      id: article.id,
      tenantId: article.tenantId,
      workspaceId: article.workspaceId,
      title: article.title,
      body: article.body,
      categoryId: article.categoryId,
      status: article.status.value,
      contentVersion: article.contentVersion,
      author: article.author,
      createdAt: article.createdAt,
      updatedAt: article.updatedAt,
      version: article.version,
    };
  }

  /** Reconstructs a {@link KnowledgeArticle} from a snapshot (no events). */
  static hydrate(snapshot: KnowledgeArticleSnapshot): KnowledgeArticle {
    const article = new KnowledgeArticle(
      {
        tenantId: snapshot.tenantId,
        workspaceId: snapshot.workspaceId,
        title: snapshot.title,
        body: snapshot.body,
        categoryId: snapshot.categoryId,
        author: snapshot.author,
      },
      snapshot.createdAt,
    );
    article.#id = snapshot.id;
    article.#status = KnowledgeArticleStatus.from(snapshot.status);
    article.#contentVersion = snapshot.contentVersion;
    article.#updatedAt = snapshot.updatedAt;
    article.#version = snapshot.version;
    return article;
  }

  /** Returns and clears the recorded domain events. */
  pullDomainEvents(): readonly EventEnvelope[] {
    const events = [...this.#events];
    this.#events.length = 0;
    return events;
  }

  /** Guards content updates: `archived` is terminal. */
  #assertUpdatable(): void {
    if (this.#status.isArchived()) {
      throw new InvalidKnowledgeValueError('Cannot update an archived article', [
        { path: 'status', message: 'Archived articles cannot be updated' },
      ]);
    }
  }

  /** Bumps the version and updated-at timestamp (optimistic concurrency). */
  #bump(now: string): void {
    this.#version += 1;
    this.#updatedAt = now;
  }
}

/** Validates + normalizes the article title. */
function normalizeTitle(title: string): string {
  const trimmed = title.trim();
  if (trimmed.length === 0) {
    throw new InvalidKnowledgeValueError('Invalid knowledge article title', [
      { path: 'title', message: 'A title is required' },
    ]);
  }
  if (trimmed.length > KNOWLEDGE_ARTICLE_TITLE_MAX_LENGTH) {
    throw new InvalidKnowledgeValueError('Invalid knowledge article title', [
      {
        path: 'title',
        message: `Title must be at most ${KNOWLEDGE_ARTICLE_TITLE_MAX_LENGTH} characters`,
      },
    ]);
  }
  return trimmed;
}

/** Validates + normalizes the article body. */
function normalizeBody(body: string): string {
  const trimmed = body.trim();
  if (trimmed.length === 0) {
    throw new InvalidKnowledgeValueError('Invalid knowledge article body', [
      { path: 'body', message: 'A body is required' },
    ]);
  }
  if (trimmed.length > KNOWLEDGE_ARTICLE_BODY_MAX_LENGTH) {
    throw new InvalidKnowledgeValueError('Invalid knowledge article body', [
      {
        path: 'body',
        message: `Body must be at most ${KNOWLEDGE_ARTICLE_BODY_MAX_LENGTH} characters`,
      },
    ]);
  }
  return trimmed;
}
