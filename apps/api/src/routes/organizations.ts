/**
 * @nexora/app-api — organization routes.
 *
 * The onboarding organization surface: create (provisions + activates +
 * first-owner) and list the organizations of the authenticated user.
 */

import type { FastifyInstance, FastifySchema } from 'fastify';
import { toOrganizationDto } from '@nexora/application-organizations';
import type {
  CreateOrganizationHandler,
  ListOrganizationsHandler,
} from '@nexora/application-organizations';

import { requireAuth } from '../plugins/auth.js';
import { toHttpError } from '../http/errors.js';

/** Request body schema for POST /api/organizations. */
const createOrganizationSchema: FastifySchema = {
  body: {
    type: 'object',
    required: ['name', 'slug', 'type'],
    additionalProperties: false,
    properties: {
      name: { type: 'string', minLength: 1, maxLength: 80 },
      slug: { type: 'string', minLength: 2, maxLength: 63 },
      type: { type: 'string', minLength: 1 },
      description: { type: 'string', maxLength: 2000 },
    },
  },
};

/** Dependencies of the organization routes. */
export interface OrganizationRoutesDependencies {
  createOrganization: CreateOrganizationHandler;
  listOrganizations: ListOrganizationsHandler;
}

/** Registers the organization routes. */
export function registerOrganizationRoutes(
  app: FastifyInstance,
  dependencies: OrganizationRoutesDependencies,
): void {
  app.post('/api/organizations', { schema: createOrganizationSchema }, async (request, reply) => {
    const auth = requireAuth(request);
    const body = request.body as {
      name: string;
      slug: string;
      type: string;
      description?: string;
    };
    const result = await dependencies.createOrganization.handle({
      name: body.name,
      slug: body.slug,
      type: body.type,
      description: body.description,
      actorId: auth.userId,
      correlationId: request.id,
    });
    if (!result.ok) {
      const http = toHttpError(result.error, request.id);
      return reply.code(http.statusCode).send(http.body);
    }
    return reply.code(201).send({ organization: toOrganizationDto(result.value.organization) });
  });

  app.get('/api/organizations', async (request, reply) => {
    const auth = requireAuth(request);
    const result = await dependencies.listOrganizations.handle({ userId: auth.userId });
    if (!result.ok) {
      const http = toHttpError(result.error, request.id);
      return reply.code(http.statusCode).send(http.body);
    }
    return { organizations: result.value };
  });
}
