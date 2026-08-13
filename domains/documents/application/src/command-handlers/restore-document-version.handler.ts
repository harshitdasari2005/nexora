/**
 * @nexora/application-documents — RestoreDocumentVersionHandler.
 *
 * The application entry point for restoring a historical version as a NEW
 * current version: delegates to the {@link DocumentApplicationService}.
 */

import type { Result } from '@nexora/shared/result';
import type { NexoraError } from '@nexora/shared/errors';
import type { CommandHandler } from '../commands/command-handler.js';

import type {
  RestoreDocumentVersionCommand,
  RestoreDocumentVersionResult,
} from '../commands/restore-document-version.command.js';
import type { DocumentApplicationService } from '../services/document-application-service.js';

/** Handles {@link RestoreDocumentVersionCommand}. */
export class RestoreDocumentVersionHandler implements CommandHandler<
  RestoreDocumentVersionCommand,
  RestoreDocumentVersionResult,
  NexoraError
> {
  readonly #service: DocumentApplicationService;

  constructor(service: DocumentApplicationService) {
    this.#service = service;
  }

  handle(
    command: RestoreDocumentVersionCommand,
  ): Promise<Result<RestoreDocumentVersionResult, NexoraError>> {
    return this.#service.restoreDocumentVersion(command);
  }
}
