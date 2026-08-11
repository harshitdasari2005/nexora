/**
 * @nexora/app-api — dashboard route.
 *
 * The first-run dashboard read model (FRONTEND.md §5): current user, current
 * organization, current workspace, installed apps (empty in v1), and recent
 * activity (empty in v1). Selection: explicit ids win; otherwise the first
 * membership / first workspace.
 */

import type { FastifyInstance } from 'fastify';
import type { TenantId } from '@nexora/contracts/common';
import type { GetCurrentUserHandler } from '@nexora/application-identity';
import type { ListOrganizationsHandler } from '@nexora/application-organizations';
import type { ListWorkspacesHandler } from '@nexora/application-workspaces';

import { requireAuth } from '../plugins/auth.js';
import { toHttpError } from '../http/errors.js';

/** Dependencies of the dashboard route. */
export interface DashboardRoutesDependencies {
  getCurrentUser: GetCurrentUserHandler;
  listOrganizations: ListOrganizationsHandler;
  listWorkspaces: ListWorkspacesHandler;
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
      const workspaces = await dependencies.listWorkspaces.handle({
        organizationId: organization.id as TenantId,
      });
      if (!workspaces.ok) {
        const http = toHttpError(workspaces.error, request.id);
        return reply.code(http.statusCode).send(http.body);
      }
      const workspaceList = workspaces.value;
      workspace =
        workspaceList.find((item) => item.id === query.workspaceId) ?? workspaceList[0] ?? null;
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
