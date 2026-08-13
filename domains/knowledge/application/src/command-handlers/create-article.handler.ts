/**
 * @nexora/application-knowledge — CreateArticleHandler.
 *
 * The application entry point for creating a knowledge article (draft).
 */

import type { Result } from '@nexora/shared/result';
import type { NexoraError } from '@nexora/shared/errors';

import type {
  CreateArticleCommand,
  CreateArticleResult,
} from '../commands/create-article.command.js';
import type { KnowledgeApplicationService } from '../services/knowledge-application-service.js';

/** Handles {@link CreateArticleCommand}. */
export class CreateArticleHandler {
  readonly #service: KnowledgeApplicationService;

  constructor(service: KnowledgeApplicationService) {
    this.#service = service;
  }

  handle(command: CreateArticleCommand): Promise<Result<CreateArticleResult, NexoraError>> {
    return this.#service.createArticle(command);
  }
}
