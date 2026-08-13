/**
 * @nexora/application-documents — ArchiveDocumentTemplateHandler.
 *
 * The application entry point for archiving a document template: delegates
 * to the {@link DocumentApplicationService}.
 */

import type { Result } from '@nexora/shared/result';
import type { NexoraError } from '@nexora/shared/errors';
import type { CommandHandler } from '../commands/command-handler.js';

import type {
  ArchiveDocumentTemplateCommand,
  ArchiveDocumentTemplateResult,
} from '../commands/archive-document-template.command.js';
import type { DocumentApplicationService } from '../services/document-application-service.js';

/** Handles {@link ArchiveDocumentTemplateCommand}. */
export class ArchiveDocumentTemplateHandler implements CommandHandler<
  ArchiveDocumentTemplateCommand,
  ArchiveDocumentTemplateResult,
  NexoraError
> {
  readonly #service: DocumentApplicationService;

  constructor(service: DocumentApplicationService) {
    this.#service = service;
  }

  handle(
    command: ArchiveDocumentTemplateCommand,
  ): Promise<Result<ArchiveDocumentTemplateResult, NexoraError>> {
    return this.#service.archiveDocumentTemplate(command);
  }
}
