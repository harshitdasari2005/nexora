/**
 * @nexora/application-knowledge — PublishArticleHandler.
 *
 * The application entry point for publishing a knowledge article.
 */

import type { Result } from '@nexora/shared/result';
import type { NexoraError } from '@nexora/shared/errors';

import type {
  PublishArticleCommand,
  PublishArticleResult,
} from '../commands/publish-article.command.js';
import type { KnowledgeApplicationService } from '../services/knowledge-application-service.js';

/** Handles {@link PublishArticleCommand}. */
export class PublishArticleHandler {
  readonly #service: KnowledgeApplicationService;

  constructor(service: KnowledgeApplicationService) {
    this.#service = service;
  }

  handle(command: PublishArticleCommand): Promise<Result<PublishArticleResult, NexoraError>> {
    return this.#service.publishArticle(command);
  }
}
