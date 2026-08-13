/**
 * @nexora/application-knowledge — RemoveArticleIndexHandler.
 *
 * The application entry point for removing a knowledge article from the
 * search corpus (archived articles must no longer answer retrieval).
 */

import type { Result } from '@nexora/shared/result';
import type { NexoraError } from '@nexora/shared/errors';

import type { RemoveArticleIndexCommand } from '../services/knowledge-application-service.js';
import type { KnowledgeApplicationService } from '../services/knowledge-application-service.js';

/** Handles {@link RemoveArticleIndexCommand}. */
export class RemoveArticleIndexHandler {
  readonly #service: KnowledgeApplicationService;

  constructor(service: KnowledgeApplicationService) {
    this.#service = service;
  }

  handle(command: RemoveArticleIndexCommand): Promise<Result<{ removed: boolean }, NexoraError>> {
    return this.#service.removeArticleIndex(command);
  }
}
