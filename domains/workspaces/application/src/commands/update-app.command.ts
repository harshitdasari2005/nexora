/**
 * @nexora/application-workspaces — UpdateApp command.
 *
 * S19 marketplace update: upgrades an installed app to the catalog's current
 * version (FR-17). The domain rejects a same-version update (the version
 * bump is the audit trail) and records `workspace.plugin_updated`.
 */

import type { TenantId, UserId, WorkspaceId } from '@nexora/contracts/common';
import type { EventEnvelope } from '@nexora/shared/events';

import type { WorkspaceInstallation } from '@nexora/domain-workspaces';

/** Upgrades an installed app to the catalog's current version. */
export interface UpdateAppCommand {
  /** The owning organization (tenant) id. */
  organizationId: TenantId;
  /** The workspace the app is installed in. */
  workspaceId: WorkspaceId;
  /** The installed catalog app id, e.g. `com.nexora.hr`. */
  appId: string;
  /** The user that updates the app. */
  actorId: UserId;
  /** Correlation id of the originating execution. */
  correlationId: string;
}

/** The outcome of a successful app update. */
export interface UpdateAppResult {
  /** The updated installation. */
  installation: WorkspaceInstallation;
  /** The version the app was updated FROM. */
  previousVersion: string;
  /** The version the app was updated TO. */
  updatedVersion: string;
  /** Domain events emitted by the use case (published by the app service). */
  events: readonly EventEnvelope[];
}
