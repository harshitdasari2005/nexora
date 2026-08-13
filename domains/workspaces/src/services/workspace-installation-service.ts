/**
 * @nexora/domain-workspaces — WorkspaceInstallationService.
 *
 * Orchestrates the {@link WorkspaceInstallation} aggregate (PSD.md §4.2
 * Apps): installing and removing plugins in a workspace. Cross-aggregate
 * invariants live here — workspace-status gating requires the Workspace
 * aggregate (docs/AGGREGATES.md).
 */

import type { EventEnvelope } from '@nexora/shared/events';
import type { Result } from '@nexora/shared/result';
import { ok, err } from '@nexora/shared/result';

import type { WorkspaceEventContext } from '../events/index.js';
import { pluginRemovedEvent } from '../events/index.js';
import { WorkspaceInstallation } from '../entities/workspace-installation.js';
import type { WorkspaceArchivedError, WorkspaceNotActiveError } from '../errors/index.js';
import {
  PluginAlreadyInstalledError,
  PluginNotFoundError,
  PluginVersionUnchangedError,
  toWorkspaceError,
  WorkspaceNotFoundError,
} from '../errors/index.js';
import type {
  WorkspaceInstallationRepository,
  WorkspaceRepository,
} from '../repositories/index.js';
import { WorkspaceInstallationPolicy } from '../policies/index.js';
import type { WorkspaceId } from '../value-objects/workspace-id.js';

/** The outcome of an installation command: the aggregate plus emitted events. */
export interface InstallationCommandResult {
  /** The mutated installation aggregate. */
  installation: WorkspaceInstallation;
  /** Domain events emitted by the operation (publish via the event bus). */
  events: readonly EventEnvelope[];
}

/** Dependencies of the {@link WorkspaceInstallationService}. */
export interface WorkspaceInstallationServiceDependencies {
  /** Installation persistence. */
  installations: WorkspaceInstallationRepository;
  /** Workspace persistence (status gating). */
  workspaces: WorkspaceRepository;
  /** Installation policy (install/remove gating). */
  installationPolicy?: WorkspaceInstallationPolicy;
}

/**
 * The installation use-case service. All methods return a `Result` so
 * expected failures are explicit values, not exceptions.
 */
export class WorkspaceInstallationService {
  readonly #installations: WorkspaceInstallationRepository;
  readonly #workspaces: WorkspaceRepository;
  readonly #policy: WorkspaceInstallationPolicy;

  constructor(dependencies: WorkspaceInstallationServiceDependencies) {
    this.#installations = dependencies.installations;
    this.#workspaces = dependencies.workspaces;
    this.#policy = dependencies.installationPolicy ?? new WorkspaceInstallationPolicy();
  }

  /**
   * Installs a plugin in a workspace: the workspace must be `active` and the
   * plugin must not already be installed.
   */
  async installPlugin(
    workspaceId: WorkspaceId,
    pluginId: string,
    pluginVersion: string,
    context: WorkspaceEventContext,
  ): Promise<
    Result<
      InstallationCommandResult,
      | WorkspaceNotFoundError
      | WorkspaceNotActiveError
      | WorkspaceArchivedError
      | PluginAlreadyInstalledError
    >
  > {
    try {
      const workspace = await this.#requireWorkspace(workspaceId);
      this.#policy.assertCanInstall(workspace.status);

      const existing = await this.#installations.findByWorkspaceAndPlugin(workspaceId, pluginId);
      if (existing !== undefined) {
        return err(new PluginAlreadyInstalledError({ workspaceId, pluginId }));
      }

      const installation = WorkspaceInstallation.create(
        { workspaceId, pluginId, pluginVersion },
        context,
      );
      await this.#installations.save(installation);
      return ok({ installation, events: installation.pullDomainEvents() });
    } catch (error) {
      return err(
        toWorkspaceError(error) as
          | WorkspaceNotFoundError
          | WorkspaceNotActiveError
          | WorkspaceArchivedError
          | PluginAlreadyInstalledError,
      );
    }
  }

  /**
   * Removes a plugin from a workspace: the installation must exist and the
   * workspace must not be archived. Emits `workspace.plugin_removed`
   * (removal is a hard delete — docs/AGGREGATES.md).
   */
  async removePlugin(
    workspaceId: WorkspaceId,
    pluginId: string,
    context: WorkspaceEventContext,
  ): Promise<
    Result<
      InstallationCommandResult,
      WorkspaceNotFoundError | WorkspaceArchivedError | PluginNotFoundError
    >
  > {
    try {
      const workspace = await this.#requireWorkspace(workspaceId);
      this.#policy.assertCanRemoveInstallation(workspace.status);

      const installation = await this.#installations.findByWorkspaceAndPlugin(
        workspaceId,
        pluginId,
      );
      if (installation === undefined) {
        return err(new PluginNotFoundError({ workspaceId, pluginId }));
      }

      const events: EventEnvelope[] = [
        pluginRemovedEvent(context, {
          workspaceId,
          installationId: installation.id,
          pluginId,
        }),
      ];
      await this.#installations.remove(installation);
      return ok({ installation, events });
    } catch (error) {
      return err(
        toWorkspaceError(error) as
          WorkspaceNotFoundError | WorkspaceArchivedError | PluginNotFoundError,
      );
    }
  }

  /**
   * Updates a plugin to a new version in a workspace: the installation must
   * exist, the workspace must not be archived, and the version must actually
   * change (an update to the same version is rejected — the version bump is
   * the audit trail). Emits `workspace.plugin_updated` (FR-17).
   */
  async updatePlugin(
    workspaceId: WorkspaceId,
    pluginId: string,
    pluginVersion: string,
    context: WorkspaceEventContext,
  ): Promise<
    Result<
      InstallationCommandResult,
      | WorkspaceNotFoundError
      | WorkspaceArchivedError
      | PluginNotFoundError
      | PluginVersionUnchangedError
    >
  > {
    try {
      const workspace = await this.#requireWorkspace(workspaceId);
      this.#policy.assertCanInstall(workspace.status);

      const installation = await this.#installations.findByWorkspaceAndPlugin(
        workspaceId,
        pluginId,
      );
      if (installation === undefined) {
        return err(new PluginNotFoundError({ workspaceId, pluginId }));
      }
      if (installation.pluginVersion === pluginVersion) {
        return err(new PluginVersionUnchangedError({ workspaceId, pluginId, pluginVersion }));
      }

      installation.updatePlugin(pluginVersion, context);
      await this.#installations.save(installation);
      return ok({ installation, events: installation.pullDomainEvents() });
    } catch (error) {
      return err(
        toWorkspaceError(error) as
          | WorkspaceNotFoundError
          | WorkspaceArchivedError
          | PluginNotFoundError
          | PluginVersionUnchangedError,
      );
    }
  }

  /** Lists the installations of a workspace. */
  async listByWorkspace(
    workspaceId: WorkspaceId,
  ): Promise<Result<readonly WorkspaceInstallation[], WorkspaceNotFoundError>> {
    const workspace = await this.#workspaces.findById(workspaceId);
    if (workspace === undefined) {
      return err(new WorkspaceNotFoundError({ workspaceId }));
    }
    return ok(await this.#installations.listByWorkspace(workspaceId));
  }

  /** Loads a workspace or throws {@link WorkspaceNotFoundError}. */
  async #requireWorkspace(workspaceId: WorkspaceId) {
    const workspace = await this.#workspaces.findById(workspaceId);
    if (workspace === undefined) {
      throw new WorkspaceNotFoundError({ workspaceId });
    }
    return workspace;
  }
}
