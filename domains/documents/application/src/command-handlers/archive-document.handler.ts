/**
 * @nexora/application-documents — ArchiveDocumentHandler.
 *
 * The application entry point for document archival: delegates to the
 * {@link DocumentApplicationService}.
 */

import type { Result } from '@nexora/shared/result';
import type { NexoraError } from '@nexora/shared/errors';
import type { CommandHandler } from '../commands/command-handler.js';

import type {
  ArchiveDocumentCommand,
  ArchiveDocumentResult,
} from '../commands/archive-document.command.js';
import type { DocumentApplicationService } from '../services/document-application-service.js';

/** Handles {@link ArchiveDocumentCommand}. */
export class ArchiveDocumentHandler implements CommandHandler<
  ArchiveDocumentCommand,
  ArchiveDocumentResult,
  NexoraError
> {
  readonly #service: DocumentApplicationService;

  constructor(service: DocumentApplicationService) {
    this.#service = service;
  }

  handle(command: ArchiveDocumentCommand): Promise<Result<ArchiveDocumentResult, NexoraError>> {
    return this.#service.archiveDocument(command);
  }
}
