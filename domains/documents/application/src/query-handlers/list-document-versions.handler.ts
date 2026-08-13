/**
 * @nexora/application-documents — ListDocumentVersionsHandler.
 *
 * The application entry point for the version-history read.
 */

import type { Result } from '@nexora/shared/result';
import type { NexoraError } from '@nexora/shared/errors';

import type { ListDocumentVersionsQuery } from '../queries/list-document-versions.query.js';
import type { DocumentVersionDto } from '../dto/document-version.dto.js';
import type { DocumentApplicationService } from '../services/document-application-service.js';

/** Handles {@link ListDocumentVersionsQuery}. */
export class ListDocumentVersionsHandler {
  readonly #service: DocumentApplicationService;

  constructor(service: DocumentApplicationService) {
    this.#service = service;
  }

  handle(
    query: ListDocumentVersionsQuery,
  ): Promise<Result<readonly DocumentVersionDto[], NexoraError>> {
    return this.#service.listDocumentVersions(
      query.organizationId,
      query.workspaceId,
      query.documentId,
    );
  }
}
