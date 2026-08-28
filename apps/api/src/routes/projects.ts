/**
 * @nexora/app-api — project routes.
 *
 * The first business-application surface (Projects vertical slice): create a
 * project in an organization and list the organization's projects. Every
 * endpoint verifies organization membership (tenant scope — the same rule
 * the AI tool uses) AND the caller's effective RBAC capability (P0 security
 * hardening): `projects.create` to create, `projects.read` to list or read
 * membership. Membership alone is tenant isolation, not authorization — a
 * member of the org without the capability is rejected with 403 even though
 * they belong to the tenant.
 */

import type { FastifyInstance, FastifySchema } from 'fastify';
import type { TenantId } from '@nexora/contracts/common';
import { toProjectDto } from '@nexora/application-projects';
import type {
  CreateProjectHandler,
  ListProjectMembersHandler,
  ListProjectsHandler,
} from '@nexora/application-projects';
import type { ListEmployeesByIdsHandler } from '@nexora/application-hr';
import type { ListOrganizationsHandler } from '@nexora/application-organizations';

import { requireAuth } from '../plugins/auth.js';
import {
  authorizePermission,
  type PermissionResolverDependencies,
} from '../business-context/permissions.js';
import { toHttpError } from '../http/errors.js';
import { sendForbidden } from './permission-response.js';

/** Request body schema for POST /api/projects. */
const createProjectSchema: FastifySchema = {
  body: {
    type: 'object',
    required: ['organizationId', 'name'],
    additionalProperties: false,
    properties: {
      organizationId: { type: 'string', minLength: 1 },
      name: { type: 'string', minLength: 1, maxLength: 80 },
      description: { type: 'string', maxLength: 2000 },
    },
  },
};

/** Dependencies of the project routes. */
export interface ProjectRoutesDependencies {
  createProject: CreateProjectHandler;
  listProjects: ListProjectsHandler;
  listProjectMembers: ListProjectMembersHandler;
  listEmployeesByIds: ListEmployeesByIdsHandler;
  listOrganizations: ListOrganizationsHandler;
  /** RBAC: the SAME trusted role resolver + catalog every surface uses. */
  permissions: PermissionResolverDependencies;
}

/** Registers the project routes. */
export function registerProjectRoutes(
  app: FastifyInstance,
  dependencies: ProjectRoutesDependencies,
): void {
  app.post('/api/projects', { schema: createProjectSchema }, async (request, reply) => {
    const auth = requireAuth(request);
    const body = request.body as {
      organizationId: string;
      name: string;
      description?: string;
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
    const authz = await authorizePermission(
      dependencies.permissions,
      { userId: auth.userId, tenantId: body.organizationId },
      'projects.create',
    );
    if (!authz.ok) {
      return sendForbidden(reply, request.id, 'create a project');
    }

    const result = await dependencies.createProject.handle({
      organizationId: body.organizationId as TenantId,
      name: body.name,
      description: body.description,
      actorId: auth.userId,
      correlationId: request.id,
    });
    if (!result.ok) {
      const http = toHttpError(result.error, request.id);
      return reply.code(http.statusCode).send(http.body);
    }
    return reply.code(201).send({ project: toProjectDto(result.value.project) });
  });

  app.get('/api/projects', async (request, reply) => {
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
    const authz = await authorizePermission(
      dependencies.permissions,
      { userId: auth.userId, tenantId: organizationId },
      'projects.read',
    );
    if (!authz.ok) {
      return sendForbidden(reply, request.id, 'view projects');
    }

    const result = await dependencies.listProjects.handle({
      organizationId: organizationId as TenantId,
    });
    if (!result.ok) {
      const http = toHttpError(result.error, request.id);
      return reply.code(http.statusCode).send(http.body);
    }
    return { projects: result.value };
  });

  app.get('/api/projects/:projectId/members', async (request, reply) => {
    const auth = requireAuth(request);
    const params = request.params as { projectId: string };
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

    // The caller must belong to the organization that owns the project.
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
    const authz = await authorizePermission(
      dependencies.permissions,
      { userId: auth.userId, tenantId: organizationId },
      'projects.read',
    );
    if (!authz.ok) {
      return sendForbidden(reply, request.id, 'view project members');
    }

    const result = await dependencies.listProjectMembers.handle({
      organizationId: organizationId as TenantId,
      projectId: params.projectId,
    });
    if (!result.ok) {
      const http = toHttpError(result.error, request.id);
      return reply.code(http.statusCode).send(http.body);
    }

    // Cross-bounded-context composition at the orchestration boundary: join
    // the employee display names through the HR application service. A
    // member whose record cannot be resolved shows its id (never an error).
    const members = result.value;
    const names = await dependencies.listEmployeesByIds.handle({
      organizationId: organizationId as TenantId,
      ids: members.map((member) => member.employeeId),
    });
    const nameById = new Map(
      (names.ok ? names.value : []).map((employee) => [employee.id, employee.name]),
    );
    return {
      members: members.map((member) => ({
        ...member,
        employeeName: nameById.get(member.employeeId) ?? null,
      })),
    };
  });
}
