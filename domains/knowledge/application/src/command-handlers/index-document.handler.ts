/**
 * @nexora/application-knowledge — IndexDocumentHandler.
 *
 * The application entry point for indexing a document into Knowledge.
 */

import type { Result } from '@nexora/shared/result';
import type { NexoraError } from '@nexora/shared/errors';

import type {
  IndexDocumentCommand,
  IndexDocumentResult,
} from '../commands/index-document.command.js';
import type { KnowledgeApplicationService } from '../services/knowledge-application-service.js';

/** Handles {@link IndexDocumentCommand}. */
export class IndexDocumentHandler {
  readonly #service: KnowledgeApplicationService;

  constructor(service: KnowledgeApplicationService) {
    this.#service = service;
  }

  handle(command: IndexDocumentCommand): Promise<Result<IndexDocumentResult, NexoraError>> {
    return this.#service.indexDocument(command);
  }
}
