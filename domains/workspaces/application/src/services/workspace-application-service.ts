/**
 * @nexora/application-workspaces — WorkspaceApplicationService.
 *
 * The application layer orchestrator (BACKEND.md §4): it coordinates the
 * workspaces domain services, collects emitted domain events, and publishes
 * them through the {@link EventPublisher} port. It contains no business
 * rules of its own — every invariant is enforced by the domain.
 */

import type { TenantId, UserId } from '@nexora/contracts/common';
import type { EventPublisher } from '@nexora/shared/events';
import { toNexoraError, type NexoraError } from '@nexora/shared/errors';
import { err, ok, type Result } from '@nexora/shared/result';
import type {
  Workspace,
  WorkspaceDomainService,
  WorkspaceMembershipService,
  WorkspaceEventContext,
  WorkspaceId,
} from '@nexora/domain-workspaces';

import type {
  CreateWorkspaceCommand,
  CreateWorkspaceResult,
} from '../commands/create-workspace.command.js';
import { toWorkspaceDto, type WorkspaceDto } from '../dto/workspace.dto.js';
import { validateCreateWorkspace } from '../validators/create-workspace.validator.js';

/** Dependencies of the {@link WorkspaceApplicationService}. */
export interface WorkspaceApplicationServiceDependencies {
  /** The workspace lifecycle domain service. */
  workspacesService: WorkspaceDomainService;
  /** The workspace membership domain service. */
  membershipsService: WorkspaceMembershipService;
  /** Publishes domain events to the platform event stream. */
  publisher: EventPublisher;
}

/**
 * The workspaces application service. All methods return a `Result` so
 * expected failures are explicit values.
 */
export class WorkspaceApplicationService {
  readonly #workspacesService: WorkspaceDomainService;
  readonly #membershipsService: WorkspaceMembershipService;
  readonly #publisher: EventPublisher;

  constructor(dependencies: WorkspaceApplicationServiceDependencies) {
    this.#workspacesService = dependencies.workspacesService;
    this.#membershipsService = dependencies.membershipsService;
    this.#publisher = dependencies.publisher;
  }

  /**
   * Creates a workspace and provisions it for the creator: create
   * (`provisioning`) → activate → add the creator as the first `owner`.
   * Emitted events are published once, after the whole sequence succeeds.
   */
  async createWorkspace(
    command: CreateWorkspaceCommand,
  ): Promise<Result<CreateWorkspaceResult, NexoraError>> {
    try {
      validateCreateWorkspace(command);
      const context = workspaceContext(
        command.actorId,
        command.correlationId,
        command.organizationId,
      );

      const created = await this.#workspacesService.create(
        {
          organizationId: command.organizationId,
          slug: command.slug,
          name: command.name,
          type: command.type,
        },
        context,
      );
      if (!created.ok) {
        return err(created.error);
      }

      const activated = await this.#workspacesService.activate(created.value.workspace.id, context);
      if (!activated.ok) {
        return err(activated.error);
      }

      const joined = await this.#membershipsService.addMember(
        created.value.workspace.id,
        command.actorId,
        'owner',
        context,
      );
      if (!joined.ok) {
        return err(joined.error);
      }

      const events = [...created.value.events, ...activated.value.events, ...joined.value.events];
      await this.#publisher.publish(events);

      return ok({
        workspace: created.value.workspace,
        membership: joined.value.membership,
        events,
      });
    } catch (error) {
      return err(toNexoraError(error, 'Unexpected workspace application error'));
    }
  }

  /**
   * Lists the workspaces of an organization, mapped to DTOs.
   */
  async listWorkspacesByOrganization(
    organizationId: TenantId,
  ): Promise<Result<readonly WorkspaceDto[], never>> {
    const listed = await this.#workspacesService.listByOrganization(organizationId);
    if (!listed.ok) {
      return err(listed.error);
    }
    return ok(listed.value.map((workspace) => toWorkspaceDto(workspace)));
  }

  /**
   * Lists the workspaces a user is a member of within an organization — the
   * authorization query for the AI tool (and any user-scoped surface).
   * Membership is the access rule: workspaces the user does not belong to are
   * never returned, and results never cross the tenant boundary
   * (`organizationId` is the trusted scope, not a model-supplied value).
   */
  async listMyWorkspaces(
    userId: UserId,
    organizationId: TenantId,
  ): Promise<Result<readonly WorkspaceDto[], never>> {
    const memberships = await this.#membershipsService.listByUser(userId);
    if (!memberships.ok) {
      return err(memberships.error);
    }
    // Batched lookup (single query) — membership-driven read paths must not
    // degrade with N+1 fetches.
    const ids = [...new Set(memberships.value.map((membership) => membership.workspaceId))];
    const batch = await this.#workspacesService.listByIds(ids);
    if (!batch.ok) {
      return err(batch.error);
    }
    const byId = new Map<WorkspaceId, Workspace>(
      batch.value.map((workspace) => [workspace.id, workspace]),
    );
    const workspaces: Workspace[] = [];
    for (const id of ids) {
      const workspace = byId.get(id);
      // Tenant filter is authoritative: even a poisoned membership pointing
      // at a foreign-tenant workspace is excluded (cross-tenant isolation).
      if (workspace !== undefined && workspace.organizationId === organizationId) {
        workspaces.push(workspace);
      }
    }
    workspaces.sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
    return ok(workspaces.map((workspace) => toWorkspaceDto(workspace)));
  }
}

/** Builds a workspaces event context (tenant + workspace known to caller). */
function workspaceContext(
  actorId: string,
  correlationId: string,
  organizationId: TenantId,
): WorkspaceEventContext {
  return { actor: { kind: 'user', id: actorId }, correlationId, organizationId };
}
