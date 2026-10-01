/**
 * @nexora/app-api — dashboard route.
 *
 * The first-run dashboard read model (FRONTEND.md §5): current user, current
 * organization, current workspace, installed apps (empty in v1), and recent
 * activity (empty in v1). Selection is MEMBERSHIP-AWARE: the workspace is
 * only ever one the caller is a genuine member of. An explicit `workspaceId`
 * wins only if it is one of the caller's memberships (a forged or foreign id
 * is ignored, never echoed); otherwise the first membership whose business
 * role resolves (the same default as /api/role-context `current`), else the
 * first membership. No membership → `workspace: null`.
 */

import type { FastifyInstance } from 'fastify';
import type { TenantId, UserId } from '@nexora/contracts/common';
import type { GetCurrentUserHandler } from '@nexora/application-identity';
import type { ListOrganizationsHandler } from '@nexora/application-organizations';
import type { ListMyWorkspacesHandler } from '@nexora/application-workspaces';

import type { MembershipBusinessRoleResolver } from '../business-context/business-role-resolver.js';

import { requireAuth } from '../plugins/auth.js';
import { toHttpError } from '../http/errors.js';

/** Dependencies of the dashboard route. */
export interface DashboardRoutesDependencies {
  getCurrentUser: GetCurrentUserHandler;
  listOrganizations: ListOrganizationsHandler;
  /** The caller's OWN workspace memberships (never the org-wide list). */
  listMyWorkspaces: ListMyWorkspacesHandler;
  /** Optional: prefers a workspace whose business role resolves (role-context parity). */
  roleResolver?: MembershipBusinessRoleResolver;
}

/** Registers the dashboard route. */
export function registerDashboardRoutes(
  app: FastifyInstance,
  dependencies: DashboardRoutesDependencies,
): void {
  app.get('/api/dashboard', async (request, reply) => {
    const auth = requireAuth(request);
    const query = request.query as { organizationId?: string; workspaceId?: string };

    const user = await dependencies.getCurrentUser.handle({ userId: auth.userId });
    if (!user.ok) {
      const http = toHttpError(user.error, request.id);
      return reply.code(http.statusCode).send(http.body);
    }

    const organizations = await dependencies.listOrganizations.handle({ userId: auth.userId });
    if (!organizations.ok) {
      const http = toHttpError(organizations.error, request.id);
      return reply.code(http.statusCode).send(http.body);
    }
    const orgList = organizations.value;
    const organization =
      orgList.find((org) => org.id === query.organizationId) ?? orgList[0] ?? null;

    let workspace = null;
    if (organization !== null) {
      const workspaces = await dependencies.listMyWorkspaces.handle({
        userId: auth.userId,
        organizationId: organization.id as TenantId,
      });
      if (!workspaces.ok) {
        const http = toHttpError(workspaces.error, request.id);
        return reply.code(http.statusCode).send(http.body);
      }
      const workspaceList = workspaces.value;
      workspace = workspaceList.find((item) => item.id === query.workspaceId) ?? null;
      if (workspace === null && dependencies.roleResolver !== undefined) {
        for (const item of workspaceList) {
          const roleId = await dependencies.roleResolver.resolve({
            userId: auth.userId as UserId,
            tenantId: organization.id,
            workspaceId: item.id,
          });
          if (roleId !== undefined) {
            workspace = item;
            break;
          }
        }
      }
      workspace ??= workspaceList[0] ?? null;
    }

    return {
      user: user.value,
      organization,
      workspace,
      installedApps: [],
      recentActivity: [],
    };
  });
}
