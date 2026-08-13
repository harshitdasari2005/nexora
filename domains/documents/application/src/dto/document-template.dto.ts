/**
 * @nexora/application-documents — document template DTO.
 *
 * The public representation of a document template. The storage reference is
 * never exposed — clients get metadata only.
 */

import type { DocumentTemplate } from '@nexora/domain-documents';

/** The public template representation. */
export interface DocumentTemplateDto {
  /** The template id. */
  id: string;
  /** The owning organization (tenant) id. */
  organizationId: string;
  /** The owning workspace id. */
  workspaceId: string;
  /** The template name. */
  name: string;
  /** An optional human-readable description. */
  description?: string;
  /** The starter content type. */
  contentType: string;
  /** The lifecycle status (`active` | `archived`). */
  status: string;
  /** ISO-8601 UTC creation time. */
  createdAt: string;
}

/** Maps a {@link DocumentTemplate} aggregate to its {@link DocumentTemplateDto}. */
export function toDocumentTemplateDto(template: DocumentTemplate): DocumentTemplateDto {
  return {
    id: template.id,
    organizationId: template.organizationId,
    workspaceId: template.workspaceId,
    name: template.name,
    description: template.description,
    contentType: template.contentType,
    status: template.status.value,
    createdAt: template.createdAt,
  };
}
