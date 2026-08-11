/**
 * @nexora/app-api — employee routes.
 *
 * The HR read/write surface for the cross-domain assignment slice: create an
 * employee record in an organization and list the organization's employees.
 * The authenticated user must be a member of the target organization
 * (membership gating — the same authorization rule the AI tool uses, so the
 * REST and AI surfaces share ONE business execution path).
 */

import type { FastifyInstance, FastifySchema } from 'fastify';
import type { TenantId } from '@nexora/contracts/common';
import { toEmployeeDto } from '@nexora/application-hr';
import type { CreateEmployeeHandler, ListEmployeesHandler } from '@nexora/application-hr';
import type { ListOrganizationsHandler } from '@nexora/application-organizations';

import { requireAuth } from '../plugins/auth.js';
import { toHttpError } from '../http/errors.js';

/** Request body schema for POST /api/employees. */
const createEmployeeSchema: FastifySchema = {
  body: {
    type: 'object',
    required: ['organizationId', 'name'],
    additionalProperties: false,
    properties: {
      organizationId: { type: 'string', minLength: 1 },
      name: { type: 'string', minLength: 1, maxLength: 120 },
    },
  },
};

/** Dependencies of the employee routes. */
export interface EmployeeRoutesDependencies {
  createEmployee: CreateEmployeeHandler;
  listEmployees: ListEmployeesHandler;
  listOrganizations: ListOrganizationsHandler;
}

/** Registers the employee routes. */
export function registerEmployeeRoutes(
  app: FastifyInstance,
  dependencies: EmployeeRoutesDependencies,
): void {
  app.post('/api/employees', { schema: createEmployeeSchema }, async (request, reply) => {
    const auth = requireAuth(request);
    const body = request.body as {
      organizationId: string;
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
