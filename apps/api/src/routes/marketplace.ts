/**
 * @nexora/app-api — marketplace routes.
 *
 * S19 Marketplace + Plugin Runtime: browse the app catalog, install with
 * install-time permission review (PRD §20.2), update, and uninstall. Every
 * endpoint follows the ONE authorization path used by the other resource
 * routes (documents, knowledge): `requireAuth` + `authorizeScope` verify the
 * caller is a member of the organization AND the workspace through the
 * trusted membership read models — a forged or foreign scope resolves to
 * 403, never to another tenant's record.
 */

import type { FastifyInstance } from 'fastify';
import type { TenantId, WorkspaceId } from '@nexora/contracts/common';
import type {
  InstallAppHandler,
  UpdateAppHandler,
  UninstallAppHandler,
  ListMarketplaceAppsHandler,
  ListInstalledAppsHandler,
} from '@nexora/application-workspaces';
import type { ListOrganizationsHandler } from '@nexora/application-organizations';
import type { ListMyWorkspacesHandler } from '@nexora/application-workspaces';

import { requireAuth } from '../plugins/auth.js';
import { toHttpError } from '../http/errors.js';
import {
  authorizePermission,
  type PermissionResolverDependencies,
} from '../business-context/permissions.js';
import { sendForbidden } from './permission-response.js';
import { authorizeScope, readScope } from './scope.js';

/** Dependencies of the marketplace routes. */
export interface MarketplaceRoutesDependencies {
  installApp: InstallAppHandler;
  updateApp: UpdateAppHandler;
  uninstallApp: UninstallAppHandler;
  listMarketplaceApps: ListMarketplaceAppsHandler;
  listInstalledApps: ListInstalledAppsHandler;
  listOrganizations: ListOrganizationsHandler;
  listMyWorkspaces: ListMyWorkspacesHandler;
  /** RBAC permission resolution — the app lifecycle requires `marketplace.manage`. */
  permissions: PermissionResolverDependencies;
}

/** Registers the marketplace routes. */
export function registerMarketplaceRoutes(
  app: FastifyInstance,
  dependencies: MarketplaceRoutesDependencies,
): void {
  // --- Marketplace browse (catalog + installed state) --------------------

  app.get('/api/marketplace/apps', async (request, reply) => {
    const auth = requireAuth(request);
    const scope = readScope(request.query);
    if (scope === undefined) {
      return reply.code(400).send({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Missing required query parameters: organizationId, workspaceId',
          requestId: request.id,
        },
      });
    }

    const denial = await authorizeScope(
      dependencies,
      auth.userId,
      scope.organizationId,
      scope.workspaceId,
    );
    if (denial !== undefined) {
      return reply.code(403).send({
        error: { code: 'AUTHORIZATION_ERROR', message: denial, requestId: request.id },
      });
    }

    const result = await dependencies.listMarketplaceApps.handle({
      workspaceId: scope.workspaceId as WorkspaceId,
    });
    if (!result.ok) {
      const http = toHttpError(result.error, request.id);
      return reply.code(http.statusCode).send(http.body);
    }
    return { apps: result.value };
  });

  app.get('/api/marketplace/apps/installed', async (request, reply) => {
    const auth = requireAuth(request);
    const scope = readScope(request.query);
    if (scope === undefined) {
      return reply.code(400).send({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Missing required query parameters: organizationId, workspaceId',
          requestId: request.id,
        },
      });
    }

    const denial = await authorizeScope(
      dependencies,
      auth.userId,
      scope.organizationId,
      scope.workspaceId,
    );
    if (denial !== undefined) {
      return reply.code(403).send({
        error: { code: 'AUTHORIZATION_ERROR', message: denial, requestId: request.id },
      });
    }

    const result = await dependencies.listInstalledApps.handle({
      workspaceId: scope.workspaceId as WorkspaceId,
    });
    if (!result.ok) {
      const http = toHttpError(result.error, request.id);
      return reply.code(http.statusCode).send(http.body);
    }
    return { apps: result.value };
  });

  // --- Install (permission review) --------------------------------------

  app.post('/api/marketplace/apps/:appId/install', async (request, reply) => {
    const auth = requireAuth(request);
    const params = request.params as { appId: string };
    const body = request.body as {
      organizationId?: string;
      workspaceId?: string;
      permissionsConfirmed?: unknown;
    };
    const scope = readScope(body);
    if (scope === undefined || typeof body.permissionsConfirmed !== 'boolean') {
      return reply.code(400).send({
        error: {
          code: 'VALIDATION_ERROR',
          message:
            'Missing or invalid body fields: organizationId, workspaceId, permissionsConfirmed (must be a boolean: the install-time permission-review confirmation)',
          requestId: request.id,
        },
      });
    }
    // The permission-review is SEMANTICALLY enforced by the application
    // service against the catalog (a false confirmation resolves to
    // PERMISSION_REVIEW_REQUIRED, never to a silent install). The route only
    // verifies the shape.
    const permissionsConfirmed = body.permissionsConfirmed;

    const denial = await authorizeScope(
      dependencies,
      auth.userId,
      scope.organizationId,
      scope.workspaceId,
    );
    if (denial !== undefined) {
      return reply.code(403).send({
        error: { code: 'AUTHORIZATION_ERROR', message: denial, requestId: request.id },
      });
    }

    const authz = await authorizePermission(
      dependencies.permissions,
      { userId: auth.userId, tenantId: scope.organizationId, workspaceId: scope.workspaceId },
      'marketplace.manage',
    );
    if (!authz.ok) {
      return sendForbidden(reply, request.id, 'manage marketplace apps');
    }

    const result = await dependencies.installApp.handle({
      organizationId: scope.organizationId as TenantId,
      workspaceId: scope.workspaceId as WorkspaceId,
      appId: params.appId,
      permissionsConfirmed,
      actorId: auth.userId,
      correlationId: request.id,
    });
    if (!result.ok) {
      const http = toHttpError(result.error, request.id);
      return reply.code(http.statusCode).send(http.body);
    }
    return reply.code(201).send({
      installationId: result.value.installation.id,
      appId: result.value.installation.pluginId,
      version: result.value.installation.pluginVersion,
    });
  });

  // --- Update ------------------------------------------------------------

  app.post('/api/marketplace/apps/:appId/update', async (request, reply) => {
    const auth = requireAuth(request);
    const params = request.params as { appId: string };
    const scope = readScope(request.body);
    if (scope === undefined) {
      return reply.code(400).send({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Missing required body fields: organizationId, workspaceId',
          requestId: request.id,
        },
      });
    }

    const denial = await authorizeScope(
      dependencies,
      auth.userId,
      scope.organizationId,
      scope.workspaceId,
    );
    if (denial !== undefined) {
      return reply.code(403).send({
        error: { code: 'AUTHORIZATION_ERROR', message: denial, requestId: request.id },
      });
    }

    const authz = await authorizePermission(
      dependencies.permissions,
      { userId: auth.userId, tenantId: scope.organizationId, workspaceId: scope.workspaceId },
      'marketplace.manage',
    );
    if (!authz.ok) {
      return sendForbidden(reply, request.id, 'manage marketplace apps');
    }

    const result = await dependencies.updateApp.handle({
      organizationId: scope.organizationId as TenantId,
      workspaceId: scope.workspaceId as WorkspaceId,
      appId: params.appId,
      actorId: auth.userId,
      correlationId: request.id,
    });
    if (!result.ok) {
      const http = toHttpError(result.error, request.id);
      return reply.code(http.statusCode).send(http.body);
    }
    return {
      installationId: result.value.installation.id,
      appId: result.value.installation.pluginId,
      previousVersion: result.value.previousVersion,
      version: result.value.updatedVersion,
    };
  });

  // --- Uninstall ----------------------------------------------------------

  app.post('/api/marketplace/apps/:appId/uninstall', async (request, reply) => {
    const auth = requireAuth(request);
    const params = request.params as { appId: string };
    const scope = readScope(request.body);
    if (scope === undefined) {
      return reply.code(400).send({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Missing required body fields: organizationId, workspaceId',
          requestId: request.id,
        },
      });
    }

    const denial = await authorizeScope(
      dependencies,
      auth.userId,
      scope.organizationId,
      scope.workspaceId,
    );
    if (denial !== undefined) {
      return reply.code(403).send({
        error: { code: 'AUTHORIZATION_ERROR', message: denial, requestId: request.id },
      });
    }

    const authz = await authorizePermission(
      dependencies.permissions,
      { userId: auth.userId, tenantId: scope.organizationId, workspaceId: scope.workspaceId },
      'marketplace.manage',
    );
    if (!authz.ok) {
      return sendForbidden(reply, request.id, 'manage marketplace apps');
    }

    const result = await dependencies.uninstallApp.handle({
      organizationId: scope.organizationId as TenantId,
      workspaceId: scope.workspaceId as WorkspaceId,
      appId: params.appId,
      actorId: auth.userId,
      correlationId: request.id,
    });
    if (!result.ok) {
      const http = toHttpError(result.error, request.id);
      return reply.code(http.statusCode).send(http.body);
    }
    return {
      appId: result.value.installation.pluginId,
      uninstalledAt: new Date().toISOString(),
    };
  });
}
