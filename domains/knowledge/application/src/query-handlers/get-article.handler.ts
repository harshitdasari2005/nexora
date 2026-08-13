/**
 * @nexora/application-knowledge — GetArticleHandler.
 *
 * The application entry point for reading one knowledge article.
 */

import type { Result } from '@nexora/shared/result';
import type { NexoraError } from '@nexora/shared/errors';

import type { GetArticleQuery } from '../queries/get-article.query.js';
import type { KnowledgeArticleDto } from '../dto/knowledge-article.dto.js';
import type { KnowledgeApplicationService } from '../services/knowledge-application-service.js';

/** Handles {@link GetArticleQuery}. */
export class GetArticleHandler {
  readonly #service: KnowledgeApplicationService;

  constructor(service: KnowledgeApplicationService) {
    this.#service = service;
  }

  handle(query: GetArticleQuery): Promise<Result<KnowledgeArticleDto, NexoraError>> {
    return this.#service.getArticle(query.tenantId, query.workspaceId, query.articleId);
  }
}
