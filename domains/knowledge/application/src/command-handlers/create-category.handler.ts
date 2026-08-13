/**
 * @nexora/application-knowledge — CreateCategoryHandler.
 *
 * The application entry point for creating a knowledge category.
 */

import type { Result } from '@nexora/shared/result';
import type { NexoraError } from '@nexora/shared/errors';

import type {
  CreateCategoryCommand,
  CreateCategoryResult,
} from '../commands/create-category.command.js';
import type { KnowledgeApplicationService } from '../services/knowledge-application-service.js';

/** Handles {@link CreateCategoryCommand}. */
export class CreateCategoryHandler {
  readonly #service: KnowledgeApplicationService;

  constructor(service: KnowledgeApplicationService) {
    this.#service = service;
  }

  handle(command: CreateCategoryCommand): Promise<Result<CreateCategoryResult, NexoraError>> {
    return this.#service.createCategory(command);
  }
}
