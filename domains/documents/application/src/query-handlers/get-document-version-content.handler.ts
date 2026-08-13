/**
 * @nexora/application-documents — GetDocumentVersionContentHandler.
 *
 * The application entry point for reading a specific revision's content.
 */

import type { Result } from '@nexora/shared/result';
import type { NexoraError } from '@nexora/shared/errors';

import type { GetDocumentVersionContentQuery } from '../queries/get-document-version-content.query.js';
import type { DocumentApplicationService } from '../services/document-application-service.js';

/** Handles {@link GetDocumentVersionContentQuery}. */
export class GetDocumentVersionContentHandler {
  readonly #service: DocumentApplicationService;

  constructor(service: DocumentApplicationService) {
    this.#service = service;
  }

  handle(
    query: GetDocumentVersionContentQuery,
  ): Promise<Result<{ content: Buffer; contentType: string }, NexoraError>> {
    return this.#service.getDocumentVersionContent(
      query.organizationId,
      query.workspaceId,
      query.documentId,
      query.version,
    );
  }
}
