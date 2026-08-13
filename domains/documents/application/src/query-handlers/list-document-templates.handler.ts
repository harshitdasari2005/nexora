/**
 * @nexora/application-documents — ListDocumentTemplatesHandler.
 *
 * The application entry point for the template-picker read.
 */

import type { Result } from '@nexora/shared/result';

import type { ListDocumentTemplatesQuery } from '../queries/list-document-templates.query.js';
import type { DocumentTemplateDto } from '../dto/document-template.dto.js';
import type { DocumentApplicationService } from '../services/document-application-service.js';

/** Handles {@link ListDocumentTemplatesQuery}. */
export class ListDocumentTemplatesHandler {
  readonly #service: DocumentApplicationService;

  constructor(service: DocumentApplicationService) {
    this.#service = service;
  }

  handle(
    query: ListDocumentTemplatesQuery,
  ): Promise<Result<readonly DocumentTemplateDto[], never>> {
    return this.#service.listDocumentTemplates(query.organizationId, query.workspaceId);
  }
}
