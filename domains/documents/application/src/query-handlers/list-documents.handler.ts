/**
 * @nexora/application-documents — ListDocumentsHandler.
 *
 * The application entry point for the workspace document list.
 */

import type { Result } from '@nexora/shared/result';

import type { ListDocumentsQuery } from '../queries/list-documents.query.js';
import type { DocumentDto } from '../dto/document.dto.js';
import type { DocumentApplicationService } from '../services/document-application-service.js';

/** Handles {@link ListDocumentsQuery}. */
export class ListDocumentsHandler {
  readonly #service: DocumentApplicationService;

  constructor(service: DocumentApplicationService) {
    this.#service = service;
  }

  handle(query: ListDocumentsQuery): Promise<Result<readonly DocumentDto[], never>> {
    return this.#service.listDocumentsByWorkspace(query.organizationId, query.workspaceId);
  }
}
