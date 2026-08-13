/**
 * @nexora/application-knowledge — IndexArticleHandler.
 *
 * The application entry point for indexing a PUBLISHED knowledge article
 * into the search corpus.
 */

import type { Result } from '@nexora/shared/result';
import type { NexoraError } from '@nexora/shared/errors';

import type { IndexArticleCommand } from '../commands/index-article.command.js';
import type { KnowledgeApplicationService } from '../services/knowledge-application-service.js';

/** Handles {@link IndexArticleCommand}. */
export class IndexArticleHandler {
  readonly #service: KnowledgeApplicationService;

  constructor(service: KnowledgeApplicationService) {
    this.#service = service;
  }

  handle(command: IndexArticleCommand): Promise<Result<{ indexed: boolean }, NexoraError>> {
    return this.#service.indexArticle(command);
  }
}
