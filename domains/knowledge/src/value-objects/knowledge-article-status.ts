/**
 * @nexora/domain-knowledge — KnowledgeArticleStatus.
 *
 * The publication lifecycle of a {@link KnowledgeArticle} (S18 Knowledge
 * Base): `draft → published → archived`. Only PUBLISHED articles are ever
 * indexed and therefore retrievable (BR-7); drafts are workspace-visible in
 * the app UI but never enter the search corpus, and archived articles leave
 * the index. `archived` is terminal in v1 (no restore).
 */

import { InvalidKnowledgeValueError } from '../errors/index.js';

/** The article lifecycle status values. */
export const KNOWLEDGE_ARTICLE_STATUSES = {
  draft: 'draft',
  published: 'published',
  archived: 'archived',
} as const;

/** A knowledge article lifecycle status. */
export type KnowledgeArticleStatusValue =
  (typeof KNOWLEDGE_ARTICLE_STATUSES)[keyof typeof KNOWLEDGE_ARTICLE_STATUSES];

/** The allowed lifecycle transitions (validate → mutate → event). */
const ARTICLE_TRANSITIONS: Record<
  KnowledgeArticleStatusValue,
  readonly KnowledgeArticleStatusValue[]
> = {
  draft: ['published', 'archived'],
  published: ['archived'],
  archived: [],
};

/**
 * The immutable lifecycle status of a knowledge article.
 */
export class KnowledgeArticleStatus {
  readonly #value: KnowledgeArticleStatusValue;

  private constructor(value: KnowledgeArticleStatusValue) {
    this.#value = value;
  }

  /** The status value. */
  get value(): KnowledgeArticleStatusValue {
    return this.#value;
  }

  /** Whether the article is a draft (never indexed). */
  isDraft(): boolean {
    return this.#value === KNOWLEDGE_ARTICLE_STATUSES.draft;
  }

  /** Whether the article is published (indexed + retrievable). */
  isPublished(): boolean {
    return this.#value === KNOWLEDGE_ARTICLE_STATUSES.published;
  }

  /** Whether the article is archived (removed from the index, terminal). */
  isArchived(): boolean {
    return this.#value === KNOWLEDGE_ARTICLE_STATUSES.archived;
  }

  /** The status value as a string (persistence/display). */
  toString(): string {
    return this.#value;
  }

  /**
   * Validates a transition to `target` and returns the new status, or throws
   * {@link InvalidKnowledgeValueError} when the transition is not allowed.
   */
  transitionTo(target: KnowledgeArticleStatusValue): KnowledgeArticleStatus {
    const allowed = ARTICLE_TRANSITIONS[this.#value];
    if (!allowed.includes(target)) {
      throw new InvalidKnowledgeValueError(
        `Cannot transition article from ${this.#value} to ${target}`,
        [{ path: 'status', message: `Cannot transition from ${this.#value} to ${target}` }],
      );
    }
    return new KnowledgeArticleStatus(target);
  }

  /** Creates a {@link KnowledgeArticleStatus} from its string value. */
  static from(value: string): KnowledgeArticleStatus {
    const normalized = value.trim();
    if (
      normalized !== KNOWLEDGE_ARTICLE_STATUSES.draft &&
      normalized !== KNOWLEDGE_ARTICLE_STATUSES.published &&
      normalized !== KNOWLEDGE_ARTICLE_STATUSES.archived
    ) {
      throw new InvalidKnowledgeValueError('Invalid knowledge article status', [
        { path: 'status', message: 'Must be draft, published, or archived' },
      ]);
    }
    return new KnowledgeArticleStatus(normalized);
  }

  /** The initial status of every new article (draft — never indexed). */
  static draft(): KnowledgeArticleStatus {
    return new KnowledgeArticleStatus(KNOWLEDGE_ARTICLE_STATUSES.draft);
  }

  /** The published status (indexed + retrievable). */
  static published(): KnowledgeArticleStatus {
    return new KnowledgeArticleStatus(KNOWLEDGE_ARTICLE_STATUSES.published);
  }

  /** The archived status (terminal; removed from the index). */
  static archived(): KnowledgeArticleStatus {
    return new KnowledgeArticleStatus(KNOWLEDGE_ARTICLE_STATUSES.archived);
  }
}
