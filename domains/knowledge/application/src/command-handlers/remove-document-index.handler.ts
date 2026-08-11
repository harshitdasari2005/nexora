/**
 * @nexora/application-knowledge — RemoveDocumentIndexHandler.
 *
 * The application entry point for removing a document from the knowledge
 * index (archived/deleted documents must no longer answer retrieval — a
 * stale entry can never surface).
 */

import type { EventEnvelope } from '@nexora/shared/events';
import type { Result } from '@nexora/shared/result';
import type { NexoraError } from '@nexora/shared/errors';

import type { RemoveDocumentIndexCommand } from '../services/knowledge-application-service.js';
import type { KnowledgeApplicationService } from '../services/knowledge-application-service.js';

/** Handles {@link RemoveDocumentIndexCommand}. */
export class RemoveDocumentIndexHandler {
  readonly #service: KnowledgeApplicationService;

  constructor(service: KnowledgeApplicationService) {
    this.#service = service;
  }

  handle(
    command: RemoveDocumentIndexCommand,
  ): Promise<Result<{ events: readonly EventEnvelope[] }, NexoraError>> {
    return this.#service.removeDocument(command);
  }
}
