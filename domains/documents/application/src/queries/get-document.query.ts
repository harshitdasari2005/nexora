/**
 * @nexora/application-documents — GetDocument query.
 *
 * Reads one document's metadata within the trusted tenant + workspace. A
 * foreign document id resolves to NOT FOUND (workspace isolation).
 */

import type { TenantId, WorkspaceId } from '@nexora/contracts/common';

/** Reads one document within the trusted scope. */
export interface GetDocumentQuery {
  /** The owning organization (tenant) id — trusted scope. */
  organizationId: TenantId;
  /** The owning workspace id — trusted scope. */
  workspaceId: WorkspaceId;
  /** The document id to read. */
  documentId: string;
}
