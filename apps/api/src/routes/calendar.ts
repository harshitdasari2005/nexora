/**
 * @nexora/app-api — calendar routes.
 *
 * The Calendar REST surface for the vertical slice: create, list, get,
 * update (reschedule), and cancel calendar events. Every endpoint enforces
 * TWO trusted server-side authorization boundaries:
 *
 * 1. Organization membership — the authenticated user must be a member of
 *    the organization (tenant scope).
 * 2. Workspace membership — the authenticated user must be a member of the
 *    target workspace (workspace scope).
 *
 * A user who is a member of organization A / workspace W1 can never read,
 * create, update, or cancel a calendar entry in workspace W2 of the same
 * organization or in another tenant. The title is DATA — it never affects
 * authorization.
 *
 * The client may not supply identity: tenant/workspace come from the body
 * (resource scope) but are verified against the trusted membership read
 * models; a forged or foreign scope resolves to 403, and a foreign entry id
 * resolves to 404 (never another workspace's record).
 */

import type { FastifyInstance, FastifySchema } from 'fastify';
import type { TenantId, UserId, WorkspaceId } from '@nexora/contracts/common';
import { toCalendarEventDto } from '@nexora/application-calendar';
import type {
  CancelCalendarEventHandler,
  CreateCalendarEventHandler,
  GetCalendarEventHandler,
  ListCalendarEventsHandler,
  UpdateCalendarEventHandler,
} from '@nexora/application-calendar';
import type { ListOrganizationsHandler } from '@nexora/application-organizations';
import type { ListMyWorkspacesHandler } from '@nexora/application-workspaces';

import { requireAuth } from '../plugins/auth.js';
import { toHttpError } from '../http/errors.js';

/** Request body schema for POST /api/calendar/events. */
const createCalendarEventSchema: FastifySchema = {
  body: {
    type: 'object',
    required: ['organizationId', 'workspaceId', 'title', 'startsAt', 'endsAt'],
    additionalProperties: false,
    properties: {
      organizationId: { type: 'string', minLength: 1 },
      workspaceId: { type: 'string', minLength: 1 },
      title: { type: 'string', minLength: 1, maxLength: 120 },
      startsAt: { type: 'string', minLength: 1 },
      endsAt: { type: 'string', minLength: 1 },
    },
  },
};

/** Request body schema for PATCH /api/calendar/events/:id. */
const updateCalendarEventSchema: FastifySchema = {
  params: {
    type: 'object',
    required: ['id'],
    additionalProperties: false,
    properties: { id: { type: 'string', minLength: 1 } },
  },
  body: {
    type: 'object',
    required: ['organizationId', 'workspaceId', 'title', 'startsAt', 'endsAt'],
    additionalProperties: false,
    properties: {
      organizationId: { type: 'string', minLength: 1 },
      workspaceId: { type: 'string', minLength: 1 },
      title: { type: 'string', minLength: 1, maxLength: 120 },
      startsAt: { type: 'string', minLength: 1 },
      endsAt: { type: 'string', minLength: 1 },
    },
  },
};

/** Dependencies of the calendar routes. */
export interface CalendarRoutesDependencies {
  createCalendarEvent: CreateCalendarEventHandler;
  updateCalendarEvent: UpdateCalendarEventHandler;
  cancelCalendarEvent: CancelCalendarEventHandler;
  listCalendarEvents: ListCalendarEventsHandler;
  getCalendarEvent: GetCalendarEventHandler;
  listOrganizations: ListOrganizationsHandler;
  listMyWorkspaces: ListMyWorkspacesHandler;
}

/**
 * Verifies the caller is a member of the organization AND the workspace
 * (two independent trusted read models — a forged scope fails closed).
 */
async function authorizeScope(
  dependencies: CalendarRoutesDependencies,
  userId: string,
  organizationId: string,
  workspaceId: string,
): Promise<string | undefined> {
  const membership = await dependencies.listOrganizations.handle({ userId: userId as UserId });
  const orgAccessible = membership.ok && membership.value.some((org) => org.id === organizationId);
  if (!orgAccessible) {
    return 'You are not a member of this organization';
  }
  const workspaces = await dependencies.listMyWorkspaces.handle({
    userId: userId as UserId,
    organizationId: organizationId as TenantId,
  });
  const workspaceAccessible =
    workspaces.ok && workspaces.value.some((workspace) => workspace.id === workspaceId);
  if (!workspaceAccessible) {
    return 'You are not a member of this workspace';
  }
  return undefined;
}

/** Registers the calendar routes. */
export function registerCalendarRoutes(
  app: FastifyInstance,
  dependencies: CalendarRoutesDependencies,
): void {
  app.post(
    '/api/calendar/events',
    { schema: createCalendarEventSchema },
    async (request, reply) => {
      const auth = requireAuth(request);
      const body = request.body as {
        organizationId: string;
        workspaceId: string;
        title: string;
        startsAt: string;
        endsAt: string;
      };

      const denial = await authorizeScope(
        dependencies,
        auth.userId,
        body.organizationId,
        body.workspaceId,
      );
      if (denial !== undefined) {
        return reply.code(403).send({
          error: { code: 'AUTHORIZATION_ERROR', message: denial, requestId: request.id },
        });
      }

      const result = await dependencies.createCalendarEvent.handle({
        organizationId: body.organizationId as TenantId,
        workspaceId: body.workspaceId as WorkspaceId,
        createdBy: auth.userId,
        actorId: auth.userId,
        correlationId: request.id,
        title: body.title,
        startsAt: body.startsAt,
        endsAt: body.endsAt,
      });
      if (!result.ok) {
        const http = toHttpError(result.error, request.id);
        return reply.code(http.statusCode).send(http.body);
      }
      return reply.code(201).send({ event: toCalendarEventDto(result.value.entry) });
    },
  );

  app.get('/api/calendar/events', async (request, reply) => {
    const auth = requireAuth(request);
    const query = request.query as { organizationId?: string; workspaceId?: string };
    if (query.organizationId === undefined || query.workspaceId === undefined) {
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
      query.organizationId,
      query.workspaceId,
    );
    if (denial !== undefined) {
      return reply.code(403).send({
        error: { code: 'AUTHORIZATION_ERROR', message: denial, requestId: request.id },
      });
    }

    const result = await dependencies.listCalendarEvents.handle({
      organizationId: query.organizationId as TenantId,
      workspaceId: query.workspaceId as WorkspaceId,
    });
    if (!result.ok) {
      const http = toHttpError(result.error, request.id);
      return reply.code(http.statusCode).send(http.body);
    }
    return { events: result.value };
  });

  app.get('/api/calendar/events/:id', async (request, reply) => {
    const auth = requireAuth(request);
    const params = request.params as { id: string };
    const query = request.query as { organizationId?: string; workspaceId?: string };
    if (query.organizationId === undefined || query.workspaceId === undefined) {
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
      query.organizationId,
      query.workspaceId,
    );
    if (denial !== undefined) {
      return reply.code(403).send({
        error: { code: 'AUTHORIZATION_ERROR', message: denial, requestId: request.id },
      });
    }

    const result = await dependencies.getCalendarEvent.handle({
      calendarEntryId: params.id,
      organizationId: query.organizationId as TenantId,
      workspaceId: query.workspaceId as WorkspaceId,
    });
    if (!result.ok) {
      const http = toHttpError(result.error, request.id);
      return reply.code(http.statusCode).send(http.body);
    }
    return { event: result.value };
  });

  app.patch(
    '/api/calendar/events/:id',
    { schema: updateCalendarEventSchema },
    async (request, reply) => {
      const auth = requireAuth(request);
      const params = request.params as { id: string };
      const body = request.body as {
        organizationId: string;
        workspaceId: string;
        title: string;
        startsAt: string;
        endsAt: string;
      };

      const denial = await authorizeScope(
        dependencies,
        auth.userId,
        body.organizationId,
        body.workspaceId,
      );
      if (denial !== undefined) {
        return reply.code(403).send({
          error: { code: 'AUTHORIZATION_ERROR', message: denial, requestId: request.id },
        });
      }

      const result = await dependencies.updateCalendarEvent.handle({
        calendarEntryId: params.id,
        organizationId: body.organizationId as TenantId,
        workspaceId: body.workspaceId as WorkspaceId,
        actorId: auth.userId,
        correlationId: request.id,
        title: body.title,
        startsAt: body.startsAt,
        endsAt: body.endsAt,
      });
      if (!result.ok) {
        const http = toHttpError(result.error, request.id);
        return reply.code(http.statusCode).send(http.body);
      }
      return { event: toCalendarEventDto(result.value.entry) };
    },
  );

  app.post('/api/calendar/events/:id/cancel', async (request, reply) => {
    const auth = requireAuth(request);
    const params = request.params as { id: string };
    const body = request.body as { organizationId?: string; workspaceId?: string };
    const organizationId = body.organizationId;
    const workspaceId = body.workspaceId;
    if (organizationId === undefined || workspaceId === undefined) {
      return reply.code(400).send({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Missing required body parameters: organizationId, workspaceId',
          requestId: request.id,
        },
      });
    }

    const denial = await authorizeScope(dependencies, auth.userId, organizationId, workspaceId);
    if (denial !== undefined) {
      return reply.code(403).send({
        error: { code: 'AUTHORIZATION_ERROR', message: denial, requestId: request.id },
      });
    }

    const result = await dependencies.cancelCalendarEvent.handle({
      calendarEntryId: params.id,
      organizationId: organizationId as TenantId,
      workspaceId: workspaceId as WorkspaceId,
      actorId: auth.userId,
      correlationId: request.id,
    });
    if (!result.ok) {
      const http = toHttpError(result.error, request.id);
      return reply.code(http.statusCode).send(http.body);
    }
    return { event: toCalendarEventDto(result.value.entry) };
  });
}
