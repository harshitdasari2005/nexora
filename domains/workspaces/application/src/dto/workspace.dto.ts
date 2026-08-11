/**
 * @nexora/application-workspaces — workspace DTO.
 *
 * The public representation of a workspace returned by queries and APIs.
 * Internal aggregates never cross module boundaries.
 */

import type { Workspace } from '@nexora/domain-workspaces';

/** The public workspace representation. */
export interface WorkspaceDto {
  /** The workspace id. */
  id: string;
  /** The owning organization (tenant) id. */
  organizationId: string;
  /** The slug, unique within the organization. */
  slug: string;
  /** The name. */
  name: string;
  /** The template type. */
  type: string;
  /** The lifecycle status (`provisioning` | `active` | `suspended` | `archived`). */
  status: string;
  /** ISO-8601 UTC creation time. */
  createdAt: string;
}

/** Maps a {@link Workspace} aggregate to its {@link WorkspaceDto}. */
export function toWorkspaceDto(workspace: Workspace): WorkspaceDto {
  return {
    id: workspace.id,
    organizationId: workspace.organizationId,
    slug: workspace.slug.value,
    name: workspace.name.value,
    type: workspace.type.value,
    status: workspace.status.value,
    createdAt: workspace.createdAt,
  };
}
