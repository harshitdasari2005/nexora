/**
 * @nexora/application-documents — CreateDocumentFromTemplateHandler.
 *
 * The application entry point for creating a document from a template:
 * delegates to the {@link DocumentApplicationService}.
 */

import type { Result } from '@nexora/shared/result';
import type { NexoraError } from '@nexora/shared/errors';
import type { CommandHandler } from '../commands/command-handler.js';

import type {
  CreateDocumentFromTemplateCommand,
  CreateDocumentFromTemplateResult,
} from '../commands/create-document-from-template.command.js';
import type { DocumentApplicationService } from '../services/document-application-service.js';

/** Handles {@link CreateDocumentFromTemplateCommand}. */
export class CreateDocumentFromTemplateHandler implements CommandHandler<
  CreateDocumentFromTemplateCommand,
  CreateDocumentFromTemplateResult,
  NexoraError
> {
  readonly #service: DocumentApplicationService;

  constructor(service: DocumentApplicationService) {
    this.#service = service;
  }

  handle(
    command: CreateDocumentFromTemplateCommand,
  ): Promise<Result<CreateDocumentFromTemplateResult, NexoraError>> {
    return this.#service.createDocumentFromTemplate(command);
  }
}
