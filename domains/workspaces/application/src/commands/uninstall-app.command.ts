/**
 * @nexora/application-workspaces — UninstallApp command.
 *
 * S19 marketplace uninstall: removes an installed app from a workspace
 * (FR-14, BKD §10.2 lifecycle: ... → Remove). The domain performs a hard
 * delete and records `workspace.plugin_removed` for the audit trail.
 */

import type { TenantId, UserId, WorkspaceId } from '@nexora/contracts/common';
import type { EventEnvelope } from '@nexora/shared/events';

import type { WorkspaceInstallation } from '@nexora/domain-workspaces';

/** Uninstalls an app from a workspace. */
export interface UninstallAppCommand {
  /** The owning organization (tenant) id. */
  organizationId: TenantId;
  /** The workspace the app is uninstalled from. */
  workspaceId: WorkspaceId;
  /** The installed catalog app id, e.g. `com.nexora.hr`. */
  appId: string;
  /** The user that uninstalls the app. */
  actorId: UserId;
  /** Correlation id of the originating execution. */
  correlationId: string;
}

/** The outcome of a successful app uninstall. */
export interface UninstallAppResult {
  /** The removed installation (pre-removal snapshot for the audit trail). */
  installation: WorkspaceInstallation;
  /** Domain events emitted by the use case (published by the app service). */
  events: readonly EventEnvelope[];
}
