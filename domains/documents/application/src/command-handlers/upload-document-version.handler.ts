/**
 * @nexora/application-documents — UploadDocumentVersionHandler.
 *
 * The application entry point for uploading a new content revision:
 * delegates to the {@link DocumentApplicationService}. The HTTP adapter and
 * any future caller share this same boundary (one business execution path).
 */

import type { Result } from '@nexora/shared/result';
import type { NexoraError } from '@nexora/shared/errors';
import type { CommandHandler } from '../commands/command-handler.js';

import type {
  UploadDocumentVersionCommand,
  UploadDocumentVersionResult,
} from '../commands/upload-document-version.command.js';
import type { DocumentApplicationService } from '../services/document-application-service.js';

/** Handles {@link UploadDocumentVersionCommand}. */
export class UploadDocumentVersionHandler implements CommandHandler<
  UploadDocumentVersionCommand,
  UploadDocumentVersionResult,
  NexoraError
> {
  readonly #service: DocumentApplicationService;

  constructor(service: DocumentApplicationService) {
    this.#service = service;
  }

  handle(
    command: UploadDocumentVersionCommand,
  ): Promise<Result<UploadDocumentVersionResult, NexoraError>> {
    return this.#service.uploadDocumentVersion(command);
  }
}
