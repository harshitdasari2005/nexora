/**
 * @nexora/application-documents — UploadDocumentHandler.
 *
 * The application entry point for document upload: delegates to the
 * {@link DocumentApplicationService}. The HTTP adapter and any future AI
 * upload tool share this same boundary (one business execution path).
 */

import type { Result } from '@nexora/shared/result';
import type { NexoraError } from '@nexora/shared/errors';
import type { CommandHandler } from '../commands/command-handler.js';

import type {
  UploadDocumentCommand,
  UploadDocumentResult,
} from '../commands/upload-document.command.js';
import type { DocumentApplicationService } from '../services/document-application-service.js';

/** Handles {@link UploadDocumentCommand}. */
export class UploadDocumentHandler implements CommandHandler<
  UploadDocumentCommand,
  UploadDocumentResult,
  NexoraError
> {
  readonly #service: DocumentApplicationService;

  constructor(service: DocumentApplicationService) {
    this.#service = service;
  }

  handle(command: UploadDocumentCommand): Promise<Result<UploadDocumentResult, NexoraError>> {
    return this.#service.uploadDocument(command);
  }
}
