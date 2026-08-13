/**
 * @nexora/application-knowledge — ListArticlesHandler.
 *
 * The application entry point for listing a workspace's knowledge articles.
 */

import type { Result } from '@nexora/shared/result';
import type { NexoraError } from '@nexora/shared/errors';

import type { ListArticlesQuery } from '../queries/list-articles.query.js';
import type { KnowledgeArticleDto } from '../dto/knowledge-article.dto.js';
import type { KnowledgeApplicationService } from '../services/knowledge-application-service.js';

/** Handles {@link ListArticlesQuery}. */
export class ListArticlesHandler {
  readonly #service: KnowledgeApplicationService;

  constructor(service: KnowledgeApplicationService) {
    this.#service = service;
  }

  handle(query: ListArticlesQuery): Promise<Result<readonly KnowledgeArticleDto[], NexoraError>> {
    return this.#service.listArticlesByWorkspace(query.tenantId, query.workspaceId);
  }
}
