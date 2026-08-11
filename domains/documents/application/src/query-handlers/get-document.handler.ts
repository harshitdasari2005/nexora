/**
 * @nexora/application-documents — GetDocumentHandler.
 *
 * The application entry point for reading one document's metadata.
 */

import type { Result } from '@nexora/shared/result';
import type { NexoraError } from '@nexora/shared/errors';

import type { GetDocumentQuery } from '../queries/get-document.query.js';
import type { DocumentDto } from '../dto/document.dto.js';
import type { DocumentApplicationService } from '../services/document-application-service.js';

/** Handles {@link GetDocumentQuery}. */
export class GetDocumentHandler {
  readonly #service: DocumentApplicationService;

  constructor(service: DocumentApplicationService) {
    this.#service = service;
  }

  handle(query: GetDocumentQuery): Promise<Result<DocumentDto, NexoraError>> {
    return this.#service.getDocument(query.organizationId, query.workspaceId, query.documentId);
  }
}
