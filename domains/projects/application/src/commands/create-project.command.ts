/**
 * @nexora/application-projects — CreateProject command.
 *
 * The vertical-slice use case that creates a new project inside an
 * organization (DOMAIN_MODEL.md §14.2): the charter is drafted in
 * `proposed` and, in v1, immediately approved by the creating owner
 * (`active`) — the approval-chain workflow (WRK-4) lands in a later sprint.
 */

import type { TenantId, UserId } from '@nexora/contracts/common';
import type { EventEnvelope } from '@nexora/shared/events';

import type { Project } from '@nexora/domain-projects';

/** Creates a new project in an organization. */
export interface CreateProjectCommand {
  /** The owning organization (tenant) id. */
  organizationId: TenantId;
  /** The project name. */
  name: string;
  /** Optional short description. */
  description?: string;
  /** The user that creates the project (the owner). */
  actorId: UserId;
  /** Correlation id of the originating execution. */
  correlationId: string;
}

/** The outcome of a successful project creation. */
export interface CreateProjectResult {
  /** The created (active) project aggregate. */
  project: Project;
  /** Domain events emitted by the use case (created/activated). */
  events: readonly EventEnvelope[];
}
