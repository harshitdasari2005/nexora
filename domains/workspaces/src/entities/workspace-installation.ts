/**
 * @nexora/domain-workspaces — WorkspaceInstallation aggregate root.
 *
 * A plugin (App) installed in a {@link Workspace} (PSD.md §4.2 "Apps": a
 * Company installs an App once; each Workspace decides whether and how to use
 * it — invariant: every installed plugin belongs to one workspace). A
 * separate aggregate from Workspace with its own repository. Removal is a
 * hard delete owned by the service (the service emits
 * `workspace.plugin_removed` — see docs/AGGREGATES.md).
 */

import type { EventEnvelope } from '@nexora/shared/events';
import { prefixedId } from '@nexora/shared/ids';
import { nowIso } from '@nexora/shared/time';

import type { WorkspaceEventContext } from '../events/index.js';
import { pluginInstalledEvent } from '../events/index.js';
import type { WorkspaceId } from '../value-objects/workspace-id.js';

/** Input for installing a plugin in a workspace. */
export interface InstallPluginInput {
  /** The workspace the plugin is installed in. */
  workspaceId: WorkspaceId;
  /** The plugin (App) id. */
  pluginId: string;
  /** The installed plugin version (semver-ish). */
  pluginVersion: string;
}

/**
 * A persistence snapshot of the {@link WorkspaceInstallation} aggregate
 * (PERSISTENCE.md §4 aggregate ownership). Plain data produced by
 * {@link WorkspaceInstallation.snapshot} and consumed by
 * {@link WorkspaceInstallation.hydrate} — no behavior.
 */
export interface WorkspaceInstallationSnapshot {
  /** The installation id. */
  id: string;
  /** The workspace the plugin is installed in. */
  workspaceId: WorkspaceId;
  /** The installed plugin id. */
  pluginId: string;
  /** The installed plugin version. */
  pluginVersion: string;
  /** ISO-8601 UTC install time. */
  installedAt: string;
  /** Monotonic version for optimistic concurrency. */
  version: number;
}

/**
 * The {@link WorkspaceInstallation} aggregate root. Use
 * {@link WorkspaceInstallation.create} to construct.
 */
export class WorkspaceInstallation {
  // Not `readonly`: reassigned only by `hydrate` (reconstitution).
  #id: string;
  readonly #workspaceId: WorkspaceId;
  readonly #pluginId: string;
  readonly #pluginVersion: string;
  readonly #installedAt: string;
  #version: number;
  readonly #events: EventEnvelope[] = [];

  private constructor(input: InstallPluginInput, installedAt: string) {
    this.#id = prefixedId('ins') as string;
    this.#workspaceId = input.workspaceId;
    this.#pluginId = input.pluginId;
    this.#pluginVersion = input.pluginVersion;
    this.#installedAt = installedAt;
    this.#version = 1;
  }

  /**
   * Creates a new {@link WorkspaceInstallation} and records a
   * {@link pluginInstalledEvent}.
   *
   * @param input   - installation data.
   * @param context - event context.
   * @param now     - ISO-8601 UTC install time (defaults to now).
   */
  static create(
    input: InstallPluginInput,
    context: WorkspaceEventContext,
    now = nowIso(),
  ): WorkspaceInstallation {
    const installation = new WorkspaceInstallation(input, now);
    installation.#events.push(
      pluginInstalledEvent(context, {
        workspaceId: installation.#workspaceId,
        installationId: installation.#id,
        pluginId: installation.#pluginId,
        pluginVersion: installation.#pluginVersion,
      }),
    );
    return installation;
  }

  /** The installation id. */
  get id(): string {
    return this.#id;
  }

  /** The workspace the plugin is installed in. */
  get workspaceId(): WorkspaceId {
    return this.#workspaceId;
  }

  /** The installed plugin id. */
  get pluginId(): string {
    return this.#pluginId;
  }

  /** The installed plugin version. */
  get pluginVersion(): string {
    return this.#pluginVersion;
  }

  /** ISO-8601 UTC install time. */
  get installedAt(): string {
    return this.#installedAt;
  }

  /** Monotonic version for optimistic concurrency. */
  get version(): number {
    return this.#version;
  }

  /**
   * Produces a persistence snapshot of the installation (PERSISTENCE.md §4
   * aggregate ownership).
   */
  static snapshot(installation: WorkspaceInstallation): WorkspaceInstallationSnapshot {
    return {
      id: installation.id,
      workspaceId: installation.workspaceId,
      pluginId: installation.pluginId,
      pluginVersion: installation.pluginVersion,
      installedAt: installation.installedAt,
      version: installation.version,
    };
  }

  /**
   * Reconstructs a {@link WorkspaceInstallation} from a persistence snapshot
   * without emitting domain events (DDD reconstitution factory).
   */
  static hydrate(snapshot: WorkspaceInstallationSnapshot): WorkspaceInstallation {
    const installation = new WorkspaceInstallation(
      {
        workspaceId: snapshot.workspaceId,
        pluginId: snapshot.pluginId,
        pluginVersion: snapshot.pluginVersion,
      },
      snapshot.installedAt,
    );
    installation.#id = snapshot.id;
    installation.#version = snapshot.version;
    return installation;
  }

  /** Returns and clears the recorded domain events. */
  pullDomainEvents(): readonly EventEnvelope[] {
    const events = [...this.#events];
    this.#events.length = 0;
    return events;
  }
}
