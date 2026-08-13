/**
 * @nexora/application-knowledge — ArchiveArticleHandler.
 *
 * The application entry point for archiving a knowledge article.
 */

import type { Result } from '@nexora/shared/result';
import type { NexoraError } from '@nexora/shared/errors';

import type {
  ArchiveArticleCommand,
  ArchiveArticleResult,
} from '../commands/archive-article.command.js';
import type { KnowledgeApplicationService } from '../services/knowledge-application-service.js';

/** Handles {@link ArchiveArticleCommand}. */
export class ArchiveArticleHandler {
  readonly #service: KnowledgeApplicationService;

  constructor(service: KnowledgeApplicationService) {
    this.#service = service;
  }

  handle(command: ArchiveArticleCommand): Promise<Result<ArchiveArticleResult, NexoraError>> {
    return this.#service.archiveArticle(command);
  }
}
