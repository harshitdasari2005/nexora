/**
 * @nexora/app-api — shared route authorization helpers.
 *
 * The ONE authorization path for resource routes (documents, knowledge,
 * calendar, ...): every endpoint verifies the caller is a member of the
 * organization (tenant scope) AND the target workspace (workspace scope)
 * through two independent trusted read models. A user who is a member of
 * organization A / workspace W1 can never read or write a record in
 * workspace W2 of the same organization or in another tenant. The client
 * may not supply identity: tenant/workspace come from the query/body
 * (resource scope) but are verified against the trusted membership read
 * models — a forged or foreign scope resolves to 403/404, never to another
 * tenant's record.
 */

import type { TenantId, UserId } from '@nexora/contracts/common';
import type { ListOrganizationsHandler } from '@nexora/application-organizations';
import type { ListMyWorkspacesHandler } from '@nexora/application-workspaces';

/** The handlers the scope check needs (membership read models). */
export interface ScopeDependencies {
  /** Resolves the caller's organization memberships. */
  listOrganizations: ListOrganizationsHandler;
  /** Resolves the caller's workspace memberships within an organization. */
  listMyWorkspaces: ListMyWorkspacesHandler;
}

/**
 * Verifies the caller is a member of the organization AND the workspace
 * (two independent trusted read models — a forged scope fails closed).
 * Returns a denial message, or `undefined` when authorized.
 */
export async function authorizeScope(
  dependencies: ScopeDependencies,
  userId: string,
  organizationId: string,
  workspaceId: string,
): Promise<string | undefined> {
  const membership = await dependencies.listOrganizations.handle({ userId: userId as UserId });
  const orgAccessible = membership.ok && membership.value.some((org) => org.id === organizationId);
  if (!orgAccessible) {
    return 'You are not a member of this organization';
  }
  const workspaces = await dependencies.listMyWorkspaces.handle({
    userId: userId as UserId,
    organizationId: organizationId as TenantId,
  });
  const workspaceAccessible =
    workspaces.ok && workspaces.value.some((workspace) => workspace.id === workspaceId);
  if (!workspaceAccessible) {
    return 'You are not a member of this workspace';
  }
  return undefined;
}

/**
 * Resolves the trusted scope query/body fields shared by the resource routes
 * (organizationId + workspaceId are REQUIRED resource scope — verified
 * against membership, never trusted blindly).
 */
export function readScope(
  value: unknown,
): { organizationId: string; workspaceId: string } | undefined {
  const scope = value as { organizationId?: unknown; workspaceId?: unknown };
  if (
    typeof scope?.organizationId !== 'string' ||
    scope.organizationId.length === 0 ||
    typeof scope?.workspaceId !== 'string' ||
    scope.workspaceId.length === 0
  ) {
    return undefined;
  }
  return { organizationId: scope.organizationId, workspaceId: scope.workspaceId };
}
