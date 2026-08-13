/**
 * @nexora/application-workspaces — WorkspaceApplicationService.
 *
 * The application layer orchestrator (BACKEND.md §4): it coordinates the
 * workspaces domain services, collects emitted domain events, and publishes
 * them through the {@link EventPublisher} port. It contains no business
 * rules of its own — every invariant is enforced by the domain.
 */

import type { TenantId, UserId, WorkspaceId } from '@nexora/contracts/common';
import type { WorkspaceNotFoundError } from '@nexora/domain-workspaces';
import type { EventPublisher } from '@nexora/shared/events';
import { toNexoraError, type NexoraError } from '@nexora/shared/errors';
import { err, ok, type Result } from '@nexora/shared/result';
import type {
  Workspace,
  WorkspaceDomainService,
  WorkspaceMembershipService,
  WorkspaceEventContext,
  WorkspaceInstallationService,
} from '@nexora/domain-workspaces';
import {
  MarketplaceAppNotFoundError,
  PermissionReviewRequiredError,
} from '@nexora/domain-workspaces';

import type {
  CreateWorkspaceCommand,
  CreateWorkspaceResult,
} from '../commands/create-workspace.command.js';
import type { InstallAppCommand, InstallAppResult } from '../commands/install-app.command.js';
import type { UpdateAppCommand, UpdateAppResult } from '../commands/update-app.command.js';
import type { UninstallAppCommand, UninstallAppResult } from '../commands/uninstall-app.command.js';
import { toWorkspaceDto, type WorkspaceDto } from '../dto/workspace.dto.js';
import { toMarketplaceAppDto, type MarketplaceAppDto } from '../dto/marketplace-app.dto.js';
import { toInstalledAppDto, type InstalledAppDto } from '../dto/installed-app.dto.js';
import { AppCatalog } from '../marketplace/app-catalog.js';
import { validateCreateWorkspace } from '../validators/create-workspace.validator.js';
import { validateInstallApp } from '../validators/install-app.validator.js';

/** Dependencies of the {@link WorkspaceApplicationService}. */
export interface WorkspaceApplicationServiceDependencies {
  /** The workspace lifecycle domain service. */
  workspacesService: WorkspaceDomainService;
  /** The workspace membership domain service. */
  membershipsService: WorkspaceMembershipService;
  /** The workspace installation (plugin lifecycle) domain service. */
  installationsService: WorkspaceInstallationService;
  /** The marketplace catalog (defaults to the first-party apps). */
  catalog?: AppCatalog;
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
  readonly #installationsService: WorkspaceInstallationService;
  readonly #catalog: AppCatalog;
  readonly #publisher: EventPublisher;

  constructor(dependencies: WorkspaceApplicationServiceDependencies) {
    this.#workspacesService = dependencies.workspacesService;
    this.#membershipsService = dependencies.membershipsService;
    this.#installationsService = dependencies.installationsService;
    this.#catalog = dependencies.catalog ?? new AppCatalog();
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
   * Installs a catalog app into a workspace (S19 marketplace). The install
   * is gated by the permission review: the caller must confirm the app's
   * declared scopes, and the app must exist in the catalog. Events are
   * published once after the domain records the installation.
   */
  async installApp(command: InstallAppCommand): Promise<Result<InstallAppResult, NexoraError>> {
    try {
      validateInstallApp(command);
      const manifest = this.#catalog.resolve(command.appId);
      if (manifest === undefined) {
        return err(new MarketplaceAppNotFoundError({ appId: command.appId }));
      }

      // Permission review (PRD §20.2): the client must explicitly confirm
      // the app's declared scopes — never install with implicit consent.
      if (command.permissionsConfirmed !== true) {
        return err(
          new PermissionReviewRequiredError({
            appId: command.appId,
            scopes: manifest.permissions.required,
          }),
        );
      }

      const context = workspaceContext(
        command.actorId,
        command.correlationId,
        command.organizationId,
      );
      const installed = await this.#installationsService.installPlugin(
        command.workspaceId,
        command.appId,
        manifest.version,
        context,
      );
      if (!installed.ok) {
        return err(installed.error);
      }

      await this.#publisher.publish(installed.value.events);
      return ok({
        installation: installed.value.installation,
        events: installed.value.events,
      });
    } catch (error) {
      return err(toNexoraError(error, 'Unexpected app install error'));
    }
  }

  /**
   * Updates an installed app to the catalog's current version (S19
   * marketplace update, FR-17). The domain rejects a same-version update;
   * the emitted `workspace.plugin_updated` event is the audit trail.
   */
  async updateApp(command: UpdateAppCommand): Promise<Result<UpdateAppResult, NexoraError>> {
    try {
      const manifest = this.#catalog.resolve(command.appId);
      if (manifest === undefined) {
        return err(new MarketplaceAppNotFoundError({ appId: command.appId }));
      }

      const context = workspaceContext(
        command.actorId,
        command.correlationId,
        command.organizationId,
      );
      const updated = await this.#installationsService.updatePlugin(
        command.workspaceId,
        command.appId,
        manifest.version,
        context,
      );
      if (!updated.ok) {
        return err(updated.error);
      }

      // The previous version is read from the domain event (the trusted
      // audit record) — the aggregate reports only the new version.
      const updatedEvent = updated.value.events.find(
        (event) => event.type === 'workspace.plugin_updated',
      );
      const updatedPayload = updatedEvent?.payload as { previousVersion?: unknown } | undefined;
      const previousVersion =
        typeof updatedPayload?.previousVersion === 'string'
          ? updatedPayload.previousVersion
          : manifest.version;

      await this.#publisher.publish(updated.value.events);
      return ok({
        installation: updated.value.installation,
        previousVersion,
        updatedVersion: updated.value.installation.pluginVersion,
        events: updated.value.events,
      });
    } catch (error) {
      return err(toNexoraError(error, 'Unexpected app update error'));
    }
  }

  /**
   * Uninstalls an app from a workspace (S19 marketplace uninstall, FR-14).
   * The domain performs the hard delete and emits `workspace.plugin_removed`
   * for the audit trail.
   */
  async uninstallApp(
    command: UninstallAppCommand,
  ): Promise<Result<UninstallAppResult, NexoraError>> {
    try {
      const context = workspaceContext(
        command.actorId,
        command.correlationId,
        command.organizationId,
      );
      const removed = await this.#installationsService.removePlugin(
        command.workspaceId,
        command.appId,
        context,
      );
      if (!removed.ok) {
        return err(removed.error);
      }

      await this.#publisher.publish(removed.value.events);
      return ok({
        installation: removed.value.installation,
        events: removed.value.events,
      });
    } catch (error) {
      return err(toNexoraError(error, 'Unexpected app uninstall error'));
    }
  }

  /**
   * Lists the marketplace catalog with each app's installed state in the
   * requesting workspace (S19 marketplace browse).
   */
  async listMarketplaceApps(
    workspaceId: WorkspaceId,
  ): Promise<Result<readonly MarketplaceAppDto[], WorkspaceNotFoundError>> {
    const installed = await this.#installationsService.listByWorkspace(workspaceId);
    if (!installed.ok) {
      return err(installed.error);
    }
    const versions = new Map(
      installed.value.map((installation) => [installation.pluginId, installation.pluginVersion]),
    );
    return ok(
      this.#catalog
        .list()
        .map((manifest) => toMarketplaceAppDto(manifest, versions.get(manifest.id))),
    );
  }

  /**
   * Lists the apps installed in a workspace with update availability (S19
   * "My Apps" read).
   */
  async listInstalledApps(
    workspaceId: WorkspaceId,
  ): Promise<Result<readonly InstalledAppDto[], WorkspaceNotFoundError>> {
    const installed = await this.#installationsService.listByWorkspace(workspaceId);
    if (!installed.ok) {
      return err(installed.error);
    }
    return ok(
      installed.value.map((installation) => toInstalledAppDto(installation, this.#catalog)),
    );
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
