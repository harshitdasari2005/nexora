/**
 * @nexora/app-api — insights route.
 *
 * The pilot measurement dashboard surface (S23 / PRD §20.4): one tenant-
 * scoped read returning the workflow-health, onboarding, audit-completeness,
 * and tenant-overview metrics computed from persisted business data.
 *
 * Security contract (the same model as every other surface):
 * - The tenant (organization) is resolved from TRUSTED organization
 *   membership (listOrganizations) — never from a client-supplied value.
 * - The optional workspace filter is verified against the membership-scoped
 *   workspace read model (listMyWorkspaces) — a forged or foreign workspace
 *   resolves to 403, never to another workspace's numbers.
 * - The metrics themselves are tenant-scoped in SQL FIRST inside the
 *   measurement repository (defense-in-depth).
 */

import type { FastifyInstance } from 'fastify';
import type { TenantId } from '@nexora/contracts/common';
import type { ListOrganizationsHandler } from '@nexora/application-organizations';
import type { ListMyWorkspacesHandler } from '@nexora/application-workspaces';
import type { GetTenantMeasurementsHandler } from '@nexora/module-measurements';

import { requireAuth } from '../plugins/auth.js';
import {
  authorizePermission,
  type PermissionResolverDependencies,
} from '../business-context/permissions.js';
import { sendForbidden } from './permission-response.js';

/** Dependencies of the insights route. */
export interface InsightsRoutesDependencies {
  /** Loads the tenant measurement snapshot. */
  getTenantMeasurements: GetTenantMeasurementsHandler;
  /** Resolves the caller's organization memberships (tenant scope). */
  listOrganizations: ListOrganizationsHandler;
  /** Verifies workspace membership (workspace scope). */
  listMyWorkspaces: ListMyWorkspacesHandler;
  /** RBAC: the SAME trusted role resolver + catalog every surface uses. */
  permissions: PermissionResolverDependencies;
}

/** Registers the insights route. */
export function registerInsightsRoutes(
  app: FastifyInstance,
  dependencies: InsightsRoutesDependencies,
): void {
  app.get('/api/insights', async (request, reply) => {
    const auth = requireAuth(request);
    const query = request.query as { organizationId?: string; workspaceId?: string };

    // Trusted tenant: from authenticated membership, never from the client.
    const membership = await dependencies.listOrganizations.handle({ userId: auth.userId });
    if (!membership.ok || membership.value.length === 0) {
      return reply.code(403).send({
        error: {
          code: 'AUTHORIZATION_ERROR',
          message: 'You are not a member of any organization',
          requestId: request.id,
        },
      });
    }
    const tenantId =
      membership.value.find((org) => org.id === query.organizationId)?.id ??
      membership.value[0]?.id;
    if (tenantId === undefined) {
      return reply.code(403).send({
        error: {
          code: 'AUTHORIZATION_ERROR',
          message: 'You are not a member of any organization',
          requestId: request.id,
        },
      });
    }

    // Optional workspace scope: verified against the membership-scoped read
    // model so a forged or foreign workspace resolves to 403.
    if (query.workspaceId !== undefined) {
      const workspaces = await dependencies.listMyWorkspaces.handle({
        userId: auth.userId,
        organizationId: tenantId as TenantId,
      });
      const accessible =
        workspaces.ok && workspaces.value.some((ws) => ws.id === query.workspaceId);
      if (!accessible) {
        return reply.code(403).send({
          error: {
            code: 'AUTHORIZATION_ERROR',
            message: 'You are not a member of this workspace',
            requestId: request.id,
          },
        });
      }
    }

    const authz = await authorizePermission(
      dependencies.permissions,
      { userId: auth.userId, tenantId, workspaceId: query.workspaceId },
      'insights.read',
    );
    if (!authz.ok) {
      return sendForbidden(reply, request.id, 'view insights');
    }

    const snapshot = await dependencies.getTenantMeasurements.handle({
      tenantId: tenantId as TenantId,
    });
    return { measurements: snapshot };
  });
}
