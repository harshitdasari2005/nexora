/**
 * @nexora/app-api — the trusted scope of an office route.
 *
 * Every office route takes the (organization, workspace) the caller says they
 * are working from. It is honoured only after the server confirmed the caller
 * is a member of both; the business role is then resolved from that seat.
 */

import type { FastifyReply } from 'fastify';
import type { TenantId, UserId } from '@nexora/contracts/common';
import type { ListOrganizationsHandler } from '@nexora/application-organizations';
import type { ListMyWorkspacesHandler } from '@nexora/application-workspaces';

/** The (organization, workspace) a caller acts from. */
export interface OfficeScope {
  organizationId: string;
  workspaceId: string;
}

export const officeScopeProperties = {
  organizationId: { type: 'string', minLength: 1, maxLength: 64 },
  workspaceId: { type: 'string', minLength: 1, maxLength: 64 },
} as const;

export const officeScopeQuery = {
  type: 'object',
  required: ['organizationId', 'workspaceId'],
  properties: officeScopeProperties,
} as const;

/** Why the caller may not act in this scope, or `undefined` when they may. */
export async function officeScopeDenial(
  dependencies: {
    listOrganizations: ListOrganizationsHandler;
    listMyWorkspaces: ListMyWorkspacesHandler;
  },
  userId: string,
  scope: OfficeScope,
): Promise<string | undefined> {
  const organizations = await dependencies.listOrganizations.handle({ userId: userId as UserId });
  if (!organizations.ok || !organizations.value.some((org) => org.id === scope.organizationId)) {
    return 'You are not a member of this organization';
  }
  const workspaces = await dependencies.listMyWorkspaces.handle({
    userId: userId as UserId,
    organizationId: scope.organizationId as TenantId,
  });
  if (!workspaces.ok || !workspaces.value.some((ws) => ws.id === scope.workspaceId)) {
    return 'You are not a member of this workspace';
  }
  return undefined;
}

export const denyScope = (reply: FastifyReply, requestId: string, message: string) =>
  reply.code(403).send({ error: { code: 'AUTHORIZATION_ERROR', message, requestId } });

export const roleContextOf = (userId: string, scope: OfficeScope) => ({
  userId,
  tenantId: scope.organizationId,
  workspaceId: scope.workspaceId,
});
