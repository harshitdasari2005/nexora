/**
 * @nexora/application-knowledge — ListCategoriesHandler.
 *
 * The application entry point for listing a workspace's knowledge
 * categories.
 */

import type { Result } from '@nexora/shared/result';
import type { NexoraError } from '@nexora/shared/errors';

import type { ListCategoriesQuery } from '../queries/list-categories.query.js';
import type { KnowledgeCategoryDto } from '../dto/knowledge-category.dto.js';
import type { KnowledgeApplicationService } from '../services/knowledge-application-service.js';

/** Handles {@link ListCategoriesQuery}. */
export class ListCategoriesHandler {
  readonly #service: KnowledgeApplicationService;

  constructor(service: KnowledgeApplicationService) {
    this.#service = service;
  }

  handle(
    query: ListCategoriesQuery,
  ): Promise<Result<readonly KnowledgeCategoryDto[], NexoraError>> {
    return this.#service.listCategoriesByWorkspace(query.tenantId, query.workspaceId);
  }
}
