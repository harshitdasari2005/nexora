/**
 * @nexora/application-knowledge — UpdateArticleHandler.
 *
 * The application entry point for updating a knowledge article's content.
 */

import type { Result } from '@nexora/shared/result';
import type { NexoraError } from '@nexora/shared/errors';

import type {
  UpdateArticleCommand,
  UpdateArticleResult,
} from '../commands/update-article.command.js';
import type { KnowledgeApplicationService } from '../services/knowledge-application-service.js';

/** Handles {@link UpdateArticleCommand}. */
export class UpdateArticleHandler {
  readonly #service: KnowledgeApplicationService;

  constructor(service: KnowledgeApplicationService) {
    this.#service = service;
  }

  handle(command: UpdateArticleCommand): Promise<Result<UpdateArticleResult, NexoraError>> {
    return this.#service.updateArticle(command);
  }
}
