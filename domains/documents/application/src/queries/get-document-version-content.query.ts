/**
 * @nexora/application-documents — GetDocumentVersionContent query.
 *
 * The S17 read of a specific content revision's bytes (version content
 * remains retrievable). The tenant + workspace are TRUSTED server-side scope;
 * an invalid (document, version) combination resolves to NOT FOUND.
 */

import type { TenantId, WorkspaceId } from '@nexora/contracts/common';

/** Reads the binary content of a document version. */
export interface GetDocumentVersionContentQuery {
  /** The owning organization (tenant) id — trusted scope. */
  organizationId: TenantId;
  /** The owning workspace id — trusted scope. */
  workspaceId: WorkspaceId;
  /** The document id. */
  documentId: string;
  /** The version whose content is read. */
  version: number;
}
