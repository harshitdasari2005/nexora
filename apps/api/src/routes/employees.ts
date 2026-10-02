/**
 * @nexora/app-api — employee routes.
 *
 * The HR read/write surface for the cross-domain assignment slice: create an
 * employee record in an organization and list the organization's employees.
 * Every endpoint verifies organization membership (tenant scope) AND the
 * caller's effective RBAC capability (P0 security hardening):
 * `employees.manage` to create, `employees.read` to list.
 */

import type { FastifyInstance, FastifySchema } from 'fastify';
import type { TenantId, UserId } from '@nexora/contracts/common';
import { toEmployeeDto } from '@nexora/application-hr';
import type { CreateEmployeeHandler, ListEmployeesHandler } from '@nexora/application-hr';
import type { ListOrganizationsHandler } from '@nexora/application-organizations';
import type { ListMyWorkspacesHandler } from '@nexora/application-workspaces';

import { requireAuth } from '../plugins/auth.js';
import {
  authorizePermission,
  type PermissionResolverDependencies,
} from '../business-context/permissions.js';
import { toHttpError } from '../http/errors.js';
import { sendForbidden } from './permission-response.js';

/** Request body schema for POST /api/employees. */
const createEmployeeSchema: FastifySchema = {
  body: {
    type: 'object',
    required: ['organizationId', 'name'],
    additionalProperties: false,
    properties: {
      organizationId: { type: 'string', minLength: 1 },
      workspaceId: { type: 'string', minLength: 1 },
      name: { type: 'string', minLength: 1, maxLength: 120 },
    },
  },
};

/** Dependencies of the employee routes. */
export interface EmployeeRoutesDependencies {
  createEmployee: CreateEmployeeHandler;
  listEmployees: ListEmployeesHandler;
  listOrganizations: ListOrganizationsHandler;
  /** Confirms a named workspace is one the caller is a member of. */
  listMyWorkspaces: ListMyWorkspacesHandler;
  /** RBAC: the SAME trusted role resolver + catalog every surface uses. */
  permissions: PermissionResolverDependencies;
}

/** Registers the employee routes. */
export function registerEmployeeRoutes(
  app: FastifyInstance,
  dependencies: EmployeeRoutesDependencies,
): void {
  /**
   * The context the caller's business role is resolved in. People work from a
   * workspace (HR from the HR workspace, a manager from their team's), and the
   * role comes from that seat — so a caller may name the workspace they are
   * acting from. It is honoured only when the caller is really a member of it;
   * otherwise the request is refused, never silently widened.
   */
  async function roleContext(
    userId: string,
    organizationId: string,
    workspaceId: string | undefined,
  ): Promise<{ userId: string; tenantId: string; workspaceId?: string } | undefined> {
    if (workspaceId === undefined) return { userId, tenantId: organizationId };
    const workspaces = await dependencies.listMyWorkspaces.handle({
      userId: userId as UserId,
      organizationId: organizationId as TenantId,
    });
    if (!workspaces.ok || !workspaces.value.some((workspace) => workspace.id === workspaceId)) {
      return undefined;
    }
    return { userId, tenantId: organizationId, workspaceId };
  }

  app.post('/api/employees', { schema: createEmployeeSchema }, async (request, reply) => {
    const auth = requireAuth(request);
    const body = request.body as {
      organizationId: string;
      workspaceId?: string;
      name: string;
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
    const createContext = await roleContext(auth.userId, body.organizationId, body.workspaceId);
    const authz =
      createContext === undefined
        ? { ok: false as const }
        : await authorizePermission(dependencies.permissions, createContext, 'employees.manage');
    if (!authz.ok) {
      return sendForbidden(reply, request.id, 'create an employee record');
    }

    const result = await dependencies.createEmployee.handle({
      organizationId: body.organizationId as TenantId,
      name: body.name,
      actorId: auth.userId,
      correlationId: request.id,
    });
    if (!result.ok) {
      const http = toHttpError(result.error, request.id);
      return reply.code(http.statusCode).send(http.body);
    }
    return reply.code(201).send({ employee: toEmployeeDto(result.value.employee) });
  });

  app.get('/api/employees', async (request, reply) => {
    const auth = requireAuth(request);
    const query = request.query as { organizationId?: string; workspaceId?: string };
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
    const readContext = await roleContext(auth.userId, organizationId, query.workspaceId);
    const authz =
      readContext === undefined
        ? { ok: false as const }
        : await authorizePermission(dependencies.permissions, readContext, 'employees.read');
    if (!authz.ok) {
      return sendForbidden(reply, request.id, 'view employees');
    }

    const result = await dependencies.listEmployees.handle({
      organizationId: organizationId as TenantId,
    });
    if (!result.ok) {
      const http = toHttpError(result.error, request.id);
      return reply.code(http.statusCode).send(http.body);
    }
    return { employees: result.value };
  });
}
