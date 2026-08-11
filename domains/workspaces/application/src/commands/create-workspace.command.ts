/**
 * @nexora/application-workspaces — CreateWorkspace command.
 *
 * The onboarding use case that provisions a new workspace inside an
 * organization, activates it, and adds the creator as the first owner
 * (PSD.md §4 WS-*; FRONTEND.md §5 workspace experience).
 */

import type { TenantId, UserId } from '@nexora/contracts/common';
import type { EventEnvelope } from '@nexora/shared/events';

import type { Workspace, WorkspaceMembership } from '@nexora/domain-workspaces';

/** Creates and provisions a new workspace in an organization. */
export interface CreateWorkspaceCommand {
  /** The owning organization (tenant) id. */
  organizationId: TenantId;
  /** The slug, unique within the organization. */
  slug: string;
  /** The workspace name. */
  name: string;
  /** The template type (one of the workspace types). */
  type: string;
  /** The user that creates the workspace (becomes the first owner). */
  actorId: UserId;
  /** Correlation id of the originating execution. */
  correlationId: string;
}

/** The outcome of a successful workspace creation. */
export interface CreateWorkspaceResult {
  /** The created (active) workspace aggregate. */
  workspace: Workspace;
  /** The first-owner membership. */
  membership: WorkspaceMembership;
  /** Domain events emitted by the use case (created/activated/member_added). */
  events: readonly EventEnvelope[];
}
