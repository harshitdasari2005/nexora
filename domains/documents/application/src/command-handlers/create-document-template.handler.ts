/**
 * @nexora/application-documents — CreateDocumentTemplateHandler.
 *
 * The application entry point for creating a document template: delegates to
 * the {@link DocumentApplicationService}.
 */

import type { Result } from '@nexora/shared/result';
import type { NexoraError } from '@nexora/shared/errors';
import type { CommandHandler } from '../commands/command-handler.js';

import type {
  CreateDocumentTemplateCommand,
  CreateDocumentTemplateResult,
} from '../commands/create-document-template.command.js';
import type { DocumentApplicationService } from '../services/document-application-service.js';

/** Handles {@link CreateDocumentTemplateCommand}. */
export class CreateDocumentTemplateHandler implements CommandHandler<
  CreateDocumentTemplateCommand,
  CreateDocumentTemplateResult,
  NexoraError
> {
  readonly #service: DocumentApplicationService;

  constructor(service: DocumentApplicationService) {
    this.#service = service;
  }

  handle(
    command: CreateDocumentTemplateCommand,
  ): Promise<Result<CreateDocumentTemplateResult, NexoraError>> {
    return this.#service.createDocumentTemplate(command);
  }
}
