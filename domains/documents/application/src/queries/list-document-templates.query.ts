/**
 * @nexora/application-documents — ListDocumentTemplates query.
 *
 * The S17 workspace-scoped read of the ACTIVE document templates (the
 * template picker). The tenant + workspace are TRUSTED server-side scope —
 * archived templates and foreign-workspace templates never appear.
 */

import type { TenantId, WorkspaceId } from '@nexora/contracts/common';

/** Lists the active templates of a workspace. */
export interface ListDocumentTemplatesQuery {
  /** The owning organization (tenant) id — trusted scope. */
  organizationId: TenantId;
  /** The owning workspace id — trusted scope. */
  workspaceId: WorkspaceId;
}
