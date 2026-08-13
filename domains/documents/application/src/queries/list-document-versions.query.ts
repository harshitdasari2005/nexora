/**
 * @nexora/application-documents — ListDocumentVersions query.
 *
 * The S17 workspace-scoped read of a document's immutable version history
 * (oldest first). The tenant + workspace are TRUSTED server-side scope — the
 * query never accepts an arbitrary document or scope.
 */

import type { TenantId, WorkspaceId } from '@nexora/contracts/common';

/** Lists the content revisions of a document, oldest first. */
export interface ListDocumentVersionsQuery {
  /** The owning organization (tenant) id — trusted scope. */
  organizationId: TenantId;
  /** The owning workspace id — trusted scope. */
  workspaceId: WorkspaceId;
  /** The document id whose history is listed. */
  documentId: string;
}
