/**
 * @nexora/application-workspaces — InstallApp command.
 *
 * S19 marketplace install: installs a catalog app into a workspace after the
 * caller confirms the install-time permission review (PRD §20.2, FR-14/15).
 * The permission review is a server-enforced gate — the client must confirm
 * the app's declared scopes before the domain records the installation.
 */

import type { TenantId, UserId, WorkspaceId } from '@nexora/contracts/common';
import type { EventEnvelope } from '@nexora/shared/events';

import type { WorkspaceInstallation } from '@nexora/domain-workspaces';

/** Installs an app from the marketplace into a workspace. */
export interface InstallAppCommand {
  /** The owning organization (tenant) id. */
  organizationId: TenantId;
  /** The workspace the app is installed into. */
  workspaceId: WorkspaceId;
  /** The catalog app id, e.g. `com.nexora.hr`. */
  appId: string;
  /** Must be `true`: the caller reviewed the app's declared permissions. */
  permissionsConfirmed: boolean;
  /** The user that installs the app. */
  actorId: UserId;
  /** Correlation id of the originating execution. */
  correlationId: string;
}

/** The outcome of a successful app install. */
export interface InstallAppResult {
  /** The recorded installation. */
  installation: WorkspaceInstallation;
  /** Domain events emitted by the use case (published by the app service). */
  events: readonly EventEnvelope[];
}
