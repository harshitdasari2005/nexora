/**
 * @nexora/app-api — current-user route.
 *
 * `GET /api/me` returns the authenticated user and the organizations they
 * belong to. This is the SPA's session-resolution endpoint (FRONTEND.md §5).
 */

import type { FastifyInstance } from 'fastify';
import type { GetCurrentUserHandler } from '@nexora/application-identity';
import type { ListOrganizationsHandler } from '@nexora/application-organizations';

import { requireAuth } from '../plugins/auth.js';
import { toHttpError } from '../http/errors.js';

/** Dependencies of the me route. */
export interface MeRoutesDependencies {
  getCurrentUser: GetCurrentUserHandler;
  listOrganizations: ListOrganizationsHandler;
}

/** Registers the me route. */
export function registerMeRoutes(app: FastifyInstance, dependencies: MeRoutesDependencies): void {
  app.get('/api/me', async (request, reply) => {
    const auth = requireAuth(request);

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

    return { user: user.value, organizations: organizations.value };
  });
}
