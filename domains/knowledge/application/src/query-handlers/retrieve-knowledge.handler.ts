/**
 * @nexora/application-knowledge — RetrieveKnowledgeHandler.
 *
 * The application entry point for permission-filtered knowledge retrieval.
 * The AI tool and any future knowledge REST surface share this boundary.
 */

import type { Result } from '@nexora/shared/result';
import type { NexoraError } from '@nexora/shared/errors';

import type { RetrieveKnowledgeQuery } from '../queries/retrieve-knowledge.query.js';
import type { RetrieveKnowledgeResult } from '../dto/knowledge-reference.dto.js';
import type { KnowledgeApplicationService } from '../services/knowledge-application-service.js';

/** Handles {@link RetrieveKnowledgeQuery}. */
export class RetrieveKnowledgeHandler {
  readonly #service: KnowledgeApplicationService;

  constructor(service: KnowledgeApplicationService) {
    this.#service = service;
  }

  handle(query: RetrieveKnowledgeQuery): Promise<Result<RetrieveKnowledgeResult, NexoraError>> {
    return this.#service.retrieve(query);
  }
}
