/**
 * @nexora/app-api — command-center route.
 *
 * `GET /api/command-center` — the current user's dynamic, role-aware
 * Command Center (S24 Phase 2). The server resolves everything from TRUSTED
 * context: the tenant (organization) from authenticated membership, the
 * optional workspace verified against membership, and the effective
 * business role from membership (never from URL/query/body/AI/frontend
 * state). Widget data is resolved server-side through the existing
 * application services; the client only renders.
 *
 * Security contract (the same model as every other surface):
 * - `?organizationId=` is validated against the caller's memberships — a
 *   forged or foreign tenant resolves to 403.
 * - `?workspaceId=` is verified against the membership-scoped workspace
 *   read model — a forged or foreign workspace resolves to 403.
 * - `?role=` / `?domain=` are IGNORED: the effective role is derived from
 *   trusted membership only.
 * - A role with no command center registered fails safely with a generic
 *   404 (no data, no internals).
 */

import type { FastifyInstance } from 'fastify';
import type { TenantId } from '@nexora/contracts/common';
import type { ListOrganizationsHandler } from '@nexora/application-organizations';
import type { ListMyWorkspacesHandler } from '@nexora/application-workspaces';
import type { GetCommandCenterHandler } from '@nexora/module-command-center';

import { requireAuth } from '../plugins/auth.js';

/** Dependencies of the command-center route. */
export interface CommandCenterRoutesDependencies {
  /** The command-center handler (generic engine). */
  getCommandCenter: GetCommandCenterHandler;
  /** Resolves the caller's organization memberships (tenant scope). */
  listOrganizations: ListOrganizationsHandler;
  /** Verifies workspace membership (workspace scope). */
  listMyWorkspaces: ListMyWorkspacesHandler;
}

/** Registers the command-center route. */
export function registerCommandCenterRoutes(
  app: FastifyInstance,
  dependencies: CommandCenterRoutesDependencies,
): void {
  app.get('/api/command-center', async (request, reply) => {
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
    let workspaceId: string | undefined;
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
      workspaceId = query.workspaceId;
    }

    const result = await dependencies.getCommandCenter.handle({
      userId: auth.userId,
      tenantId: tenantId as TenantId,
      workspaceId,
    });
    if (!result.ok) {
      // Fails safely: no command center is registered for the caller's
      // effective role (or the caller has no business role at all).
      return reply.code(404).send({
        error: {
          code: 'NOT_FOUND',
          message: 'No command center is configured for your role',
          requestId: request.id,
        },
      });
    }
    return result.center;
  });
}
