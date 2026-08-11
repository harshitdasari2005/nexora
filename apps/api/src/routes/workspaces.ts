/**
 * @nexora/app-api — workspace routes.
 *
 * The onboarding workspace surface: create (provisions + activates +
 * first-owner) and list the workspaces of an organization. The authenticated
 * user must be a member of the target organization (membership gating).
 */

import type { FastifyInstance, FastifySchema } from 'fastify';
import type { TenantId } from '@nexora/contracts/common';
import { toWorkspaceDto } from '@nexora/application-workspaces';
import type { CreateWorkspaceHandler, ListWorkspacesHandler } from '@nexora/application-workspaces';
import type { ListOrganizationsHandler } from '@nexora/application-organizations';

import { requireAuth } from '../plugins/auth.js';
import { toHttpError } from '../http/errors.js';

/** Request body schema for POST /api/workspaces. */
const createWorkspaceSchema: FastifySchema = {
  body: {
    type: 'object',
    required: ['organizationId', 'name', 'slug', 'type'],
    additionalProperties: false,
    properties: {
      organizationId: { type: 'string', minLength: 1 },
      name: { type: 'string', minLength: 1, maxLength: 80 },
      slug: { type: 'string', minLength: 2, maxLength: 63 },
      type: { type: 'string', minLength: 1 },
    },
  },
};

/** Dependencies of the workspace routes. */
export interface WorkspaceRoutesDependencies {
  createWorkspace: CreateWorkspaceHandler;
  listWorkspaces: ListWorkspacesHandler;
  listOrganizations: ListOrganizationsHandler;
}

/** Registers the workspace routes. */
export function registerWorkspaceRoutes(
  app: FastifyInstance,
  dependencies: WorkspaceRoutesDependencies,
): void {
  app.post('/api/workspaces', { schema: createWorkspaceSchema }, async (request, reply) => {
    const auth = requireAuth(request);
    const body = request.body as {
      organizationId: string;
      name: string;
      slug: string;
      type: string;
    };

    const membership = await dependencies.listOrganizations.handle({ userId: auth.userId });
    const canAccess =
      membership.ok && membership.value.some((org) => org.id === body.organizationId);
    if (!canAccess) {
      return reply.code(403).send({
        error: {
          code: 'AUTHORIZATION_ERROR',
          message: 'You are not a member of this organization',
          requestId: request.id,
        },
      });
    }

    const result = await dependencies.createWorkspace.handle({
      organizationId: body.organizationId as TenantId,
      name: body.name,
      slug: body.slug,
      type: body.type,
      actorId: auth.userId,
      correlationId: request.id,
    });
    if (!result.ok) {
      const http = toHttpError(result.error, request.id);
      return reply.code(http.statusCode).send(http.body);
    }
    return reply.code(201).send({ workspace: toWorkspaceDto(result.value.workspace) });
  });

  app.get('/api/workspaces', async (request, reply) => {
    const auth = requireAuth(request);
    const query = request.query as { organizationId?: string };
    const organizationId = query.organizationId;
    if (organizationId === undefined) {
      return reply.code(400).send({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Missing required query parameter: organizationId',
          requestId: request.id,
        },
      });
    }

    const membership = await dependencies.listOrganizations.handle({ userId: auth.userId });
    const canAccess = membership.ok && membership.value.some((org) => org.id === organizationId);
    if (!canAccess) {
      return reply.code(403).send({
        error: {
          code: 'AUTHORIZATION_ERROR',
          message: 'You are not a member of this organization',
          requestId: request.id,
        },
      });
    }

    const result = await dependencies.listWorkspaces.handle({
      organizationId: organizationId as TenantId,
    });
    if (!result.ok) {
      const http = toHttpError(result.error, request.id);
      return reply.code(http.statusCode).send(http.body);
    }
    return { workspaces: result.value };
  });
}
