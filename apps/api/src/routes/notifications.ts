/**
 * @nexora/app-api — notification routes.
 *
 * The Notification Center + Activity Feed surface (PSD.md §10): list the
 * authenticated user's notifications, read/unread state, preferences, the
 * workspace-scoped activity feed, and a real-time SSE stream.
 *
 * Security contract (the same model as every other surface):
 * - The recipient is ALWAYS the authenticated user — a client-supplied
 *   `userId` is ignored (the endpoint never accepts one).
 * - The tenant (organization) is resolved from TRUSTED organization
 *   membership (listOrganizations) — never from a client-supplied value.
 * - The optional workspace filter is verified against the membership-scoped
 *   workspace read model (listMyWorkspaces) — a forged or foreign workspace
 *   resolves to 403, never to another workspace's notifications.
 * - Notification id enumeration is scoped: a foreign or non-existent id
 *   returns 404, never data.
 *
 * RBAC capability gating (P0 security hardening) applies only to
 * `GET /api/activity`: unlike the notification inbox/preferences/stream
 * endpoints above (which are inherently self-scoped to the authenticated
 * recipient and have no corresponding business capability in the catalog),
 * the activity feed surfaces OTHER members' actions across the workspace —
 * a real business resource, gated by the existing `activity.read`
 * capability via the SAME `authorizePermission` every other surface uses.
 */

import type { FastifyInstance, FastifySchema } from 'fastify';
import type { TenantId, UserId, WorkspaceId } from '@nexora/contracts/common';
import type { ListOrganizationsHandler } from '@nexora/application-organizations';
import type { ListMyWorkspacesHandler } from '@nexora/application-workspaces';
import {
  ActivityItem,
  Notification,
  type GetNotificationPreferencesHandler,
  type ListActivityHandler,
  type ListNotificationsHandler,
  type MarkAllNotificationsReadHandler,
  type MarkNotificationReadHandler,
  type NotificationStream,
  type UnreadNotificationsCountHandler,
  type UpdateNotificationPreferencesCommand,
  type UpdateNotificationPreferencesHandler,
} from '@nexora/module-notifications';

import { formatSse } from '../ai/chat-stream.js';
import { requireAuth } from '../plugins/auth.js';
import {
  authorizePermission,
  type PermissionResolverDependencies,
} from '../business-context/permissions.js';
import { sendForbidden } from './permission-response.js';

/** Request body schema for PUT /api/notifications/preferences. */
const updatePreferencesSchema: FastifySchema = {
  body: {
    type: 'object',
    required: ['category', 'enabled'],
    additionalProperties: false,
    properties: {
      category: { type: 'string', minLength: 1, maxLength: 32 },
      enabled: { type: 'boolean' },
    },
  },
};

/**
 * How often an open notification stream re-checks its session when no event
 * arrives (bounded: one primary-key lookup per open stream per interval).
 */
export const SSE_SESSION_RECHECK_MS = 30_000;

/** Dependencies of the notification routes. */
export interface NotificationRoutesDependencies {
  /**
   * Whether a session is still live (read-only; the session domain service's
   * `isLive`). The live SSE stream re-checks it so a stream cannot outlive its
   * session.
   */
  isSessionLive: (sessionId: string) => Promise<boolean>;
  /** The recipient-scoped inbox listing handler. */
  listNotifications: ListNotificationsHandler;
  /** The unread-count handler. */
  unreadNotifications: UnreadNotificationsCountHandler;
  /** The mark-one-read handler. */
  markNotificationRead: MarkNotificationReadHandler;
  /** The mark-all-read handler. */
  markAllNotificationsRead: MarkAllNotificationsReadHandler;
  /** The preferences read handler. */
  getNotificationPreferences: GetNotificationPreferencesHandler;
  /** The preferences update handler. */
  updateNotificationPreferences: UpdateNotificationPreferencesHandler;
  /** The workspace-scoped activity feed handler. */
  listActivity: ListActivityHandler;
  /** Resolves the caller's organization memberships (tenant scope). */
  listOrganizations: ListOrganizationsHandler;
  /** Verifies workspace membership (workspace scope). */
  listMyWorkspaces: ListMyWorkspacesHandler;
  /** The real-time notification stream (SSE transport seam). */
  stream: NotificationStream;
  /** RBAC: the SAME trusted role resolver + catalog every surface uses. */
  permissions: PermissionResolverDependencies;
}

/**
 * Whether a stream notification event belongs to this SSE connection — the
 * recipient is always the authenticated user (never a client-supplied id).
 */
export function isNotificationForRecipient(recipientId: string, connectionUserId: string): boolean {
  return recipientId === connectionUserId;
}

/**
 * Whether a stream activity event is in scope for this SSE connection.
 *
 * `connectionTenantId` MUST be the tenant resolved from trusted membership
 * for this connection — never `request.auth.tenantId`, which is the identity
 * bootstrap tenant (`tnt_platform`) and matches no real organization. An
 * unresolved tenant (`undefined`) forwards nothing (fail closed).
 */
export function isActivityInScope(
  itemTenantId: string,
  connectionTenantId: string | undefined,
): boolean {
  return connectionTenantId !== undefined && itemTenantId === connectionTenantId;
}

/**
 * What one SSE connection may see of the activity feed — resolved ONCE at
 * connect from trusted server state, with exactly the rules of
 * `GET /api/activity`: workspace membership when a workspace is named, and
 * the `activity.read` capability evaluated in that scope. `allowed: false`
 * (non-member workspace, missing capability, no tenant) withholds every
 * activity frame; the connection still carries the caller's own
 * notifications.
 */
export interface ActivityStreamScope {
  allowed: boolean;
  tenantId: string | undefined;
  /** The verified workspace the feed is narrowed to (absent = organization feed). */
  workspaceId: string | undefined;
}

/**
 * Whether a stream activity item is visible to this connection. Mirrors the
 * GET feed: the tenant always matches; a workspace-scoped connection receives
 * only its own workspace's items (an org-level item with no workspace is not
 * part of a workspace feed); an organization-scoped connection receives the
 * organization feed, exactly like `GET /api/activity?organizationId=…`.
 */
export function isActivityVisibleToStream(
  item: { tenantId: string; workspaceId?: string },
  scope: ActivityStreamScope,
): boolean {
  if (!scope.allowed || !isActivityInScope(item.tenantId, scope.tenantId)) {
    return false;
  }
  return scope.workspaceId === undefined || item.workspaceId === scope.workspaceId;
}

/** Resolves the trusted tenant (first membership or verified query org). */
async function resolveTenant(
  dependencies: NotificationRoutesDependencies,
  userId: UserId,
  organizationId: string | undefined,
): Promise<string | undefined> {
  const membership = await dependencies.listOrganizations.handle({ userId });
  if (!membership.ok || membership.value.length === 0) {
    return undefined;
  }
  if (organizationId === undefined) {
    // First membership is the default tenant scope (dashboard convention).
    return membership.value[0]?.id;
  }
  const accessible = membership.value.some((org) => org.id === organizationId);
  return accessible ? organizationId : undefined;
}

/** Verifies the workspace belongs to the trusted tenant (else 403). */
async function workspaceDenial(
  dependencies: NotificationRoutesDependencies,
  userId: UserId,
  tenantId: TenantId,
  workspaceId: string | undefined,
): Promise<string | undefined> {
  if (workspaceId === undefined) {
    return undefined;
  }
  const workspaces = await dependencies.listMyWorkspaces.handle({
    userId,
    organizationId: tenantId,
  });
  const accessible = workspaces.ok && workspaces.value.some((ws) => ws.id === workspaceId);
  return accessible ? undefined : 'You are not a member of this workspace';
}

/** Resolves {@link ActivityStreamScope} from trusted state (never from the request alone). */
export async function resolveActivityStreamScope(
  dependencies: NotificationRoutesDependencies,
  userId: UserId,
  tenantId: string | undefined,
  workspaceId: string | undefined,
): Promise<ActivityStreamScope> {
  const denied: ActivityStreamScope = { allowed: false, tenantId, workspaceId: undefined };
  if (tenantId === undefined) {
    return denied;
  }
  const denial = await workspaceDenial(dependencies, userId, tenantId as TenantId, workspaceId);
  if (denial !== undefined) {
    return denied;
  }
  const authz = await authorizePermission(
    dependencies.permissions,
    { userId, tenantId: tenantId as TenantId, workspaceId },
    'activity.read',
  );
  return authz.ok ? { allowed: true, tenantId, workspaceId } : denied;
}

/** Registers the notification routes. */
export function registerNotificationRoutes(
  app: FastifyInstance,
  dependencies: NotificationRoutesDependencies,
): void {
  app.get('/api/notifications', async (request, reply) => {
    const auth = requireAuth(request);
    const query = request.query as {
      organizationId?: string;
      workspaceId?: string;
      limit?: string;
    };

    const tenantId = await resolveTenant(dependencies, auth.userId, query.organizationId);
    if (tenantId === undefined) {
      return reply.code(403).send({
        error: {
          code: 'AUTHORIZATION_ERROR',
          message: 'You are not a member of any organization',
          requestId: request.id,
        },
      });
    }
    const denial = await workspaceDenial(
      dependencies,
      auth.userId,
      tenantId as TenantId,
      query.workspaceId,
    );
    if (denial !== undefined) {
      return reply.code(403).send({
        error: { code: 'AUTHORIZATION_ERROR', message: denial, requestId: request.id },
      });
    }

    const limit = query.limit === undefined ? undefined : Number(query.limit);
    const result = await dependencies.listNotifications.handle({
      userId: auth.userId,
      tenantId: tenantId as TenantId,
      workspaceId: query.workspaceId as WorkspaceId | undefined,
      limit: Number.isFinite(limit) && limit !== undefined ? limit : undefined,
    });
    if (!result.ok) {
      return reply.code(500).send({
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Could not list notifications',
          requestId: request.id,
        },
      });
    }
    return { notifications: result.value.notifications };
  });

  app.get('/api/notifications/unread-count', async (request, reply) => {
    const auth = requireAuth(request);
    const query = request.query as { organizationId?: string; workspaceId?: string };

    const tenantId = await resolveTenant(dependencies, auth.userId, query.organizationId);
    if (tenantId === undefined) {
      return reply.code(403).send({
        error: {
          code: 'AUTHORIZATION_ERROR',
          message: 'You are not a member of any organization',
          requestId: request.id,
        },
      });
    }
    const denial = await workspaceDenial(
      dependencies,
      auth.userId,
      tenantId as TenantId,
      query.workspaceId,
    );
    if (denial !== undefined) {
      return reply.code(403).send({
        error: { code: 'AUTHORIZATION_ERROR', message: denial, requestId: request.id },
      });
    }

    const result = await dependencies.unreadNotifications.handle({
      userId: auth.userId,
      tenantId: tenantId as TenantId,
      workspaceId: query.workspaceId as WorkspaceId | undefined,
    });
    if (!result.ok) {
      return reply.code(500).send({
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Could not count notifications',
          requestId: request.id,
        },
      });
    }
    return { count: result.value.count };
  });

  app.post('/api/notifications/:id/read', async (request, reply) => {
    const auth = requireAuth(request);
    const params = request.params as { id: string };
    const query = request.query as { organizationId?: string };

    const tenantId = await resolveTenant(dependencies, auth.userId, query.organizationId);
    if (tenantId === undefined) {
      return reply.code(403).send({
        error: {
          code: 'AUTHORIZATION_ERROR',
          message: 'You are not a member of any organization',
          requestId: request.id,
        },
      });
    }

    const result = await dependencies.markNotificationRead.handle({
      notificationId: params.id,
      userId: auth.userId,
      tenantId: tenantId as TenantId,
    });
    if (!result.ok) {
      return reply.code(500).send({
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Could not mark notification read',
          requestId: request.id,
        },
      });
    }
    if ('notification' in result.value) {
      return { notification: result.value.notification };
    }
    // Foreign/unknown ids resolve to 404 (no enumeration).
    return reply.code(404).send({
      error: { code: 'NOT_FOUND', message: 'Notification not found', requestId: request.id },
    });
  });

  app.post('/api/notifications/read-all', async (request, reply) => {
    const auth = requireAuth(request);
    const query = request.query as { organizationId?: string; workspaceId?: string };

    const tenantId = await resolveTenant(dependencies, auth.userId, query.organizationId);
    if (tenantId === undefined) {
      return reply.code(403).send({
        error: {
          code: 'AUTHORIZATION_ERROR',
          message: 'You are not a member of any organization',
          requestId: request.id,
        },
      });
    }
    const denial = await workspaceDenial(
      dependencies,
      auth.userId,
      tenantId as TenantId,
      query.workspaceId,
    );
    if (denial !== undefined) {
      return reply.code(403).send({
        error: { code: 'AUTHORIZATION_ERROR', message: denial, requestId: request.id },
      });
    }

    const result = await dependencies.markAllNotificationsRead.handle({
      userId: auth.userId,
      tenantId: tenantId as TenantId,
      workspaceId: query.workspaceId as WorkspaceId | undefined,
    });
    if (!result.ok) {
      return reply.code(500).send({
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Could not mark notifications read',
          requestId: request.id,
        },
      });
    }
    return { marked: result.value.marked };
  });

  app.get('/api/notifications/preferences', async (request, reply) => {
    const auth = requireAuth(request);
    const query = request.query as { organizationId?: string };

    const tenantId = await resolveTenant(dependencies, auth.userId, query.organizationId);
    if (tenantId === undefined) {
      return reply.code(403).send({
        error: {
          code: 'AUTHORIZATION_ERROR',
          message: 'You are not a member of any organization',
          requestId: request.id,
        },
      });
    }

    const result = await dependencies.getNotificationPreferences.handle({
      userId: auth.userId,
      tenantId: tenantId as TenantId,
    });
    if (!result.ok) {
      return reply.code(500).send({
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Could not load preferences',
          requestId: request.id,
        },
      });
    }
    return { preferences: result.value.preferences };
  });

  app.put(
    '/api/notifications/preferences',
    { schema: updatePreferencesSchema },
    async (request, reply) => {
      const auth = requireAuth(request);
      const query = request.query as { organizationId?: string };
      const body = request.body as { category: string; enabled: boolean };

      const tenantId = await resolveTenant(dependencies, auth.userId, query.organizationId);
      if (tenantId === undefined) {
        return reply.code(403).send({
          error: {
            code: 'AUTHORIZATION_ERROR',
            message: 'You are not a member of any organization',
            requestId: request.id,
          },
        });
      }

      const result = await dependencies.updateNotificationPreferences.handle({
        userId: auth.userId,
        tenantId: tenantId as TenantId,
        category: body.category as UpdateNotificationPreferencesCommand['category'],
        enabled: body.enabled,
      });
      if (!result.ok) {
        return reply.code(500).send({
          error: {
            code: 'INTERNAL_ERROR',
            message: 'Could not update preferences',
            requestId: request.id,
          },
        });
      }
      return { preferences: result.value.preferences };
    },
  );

  app.get('/api/activity', async (request, reply) => {
    const auth = requireAuth(request);
    const query = request.query as {
      organizationId?: string;
      workspaceId?: string;
      limit?: string;
    };

    const tenantId = await resolveTenant(dependencies, auth.userId, query.organizationId);
    if (tenantId === undefined) {
      return reply.code(403).send({
        error: {
          code: 'AUTHORIZATION_ERROR',
          message: 'You are not a member of any organization',
          requestId: request.id,
        },
      });
    }
    const denial = await workspaceDenial(
      dependencies,
      auth.userId,
      tenantId as TenantId,
      query.workspaceId,
    );
    if (denial !== undefined) {
      return reply.code(403).send({
        error: { code: 'AUTHORIZATION_ERROR', message: denial, requestId: request.id },
      });
    }

    const authz = await authorizePermission(
      dependencies.permissions,
      {
        userId: auth.userId,
        tenantId: tenantId,
        workspaceId: query.workspaceId,
      },
      'activity.read',
    );
    if (!authz.ok) {
      return sendForbidden(reply, request.id, 'view the activity feed');
    }

    const limit = query.limit === undefined ? undefined : Number(query.limit);
    const result = await dependencies.listActivity.handle({
      tenantId: tenantId as TenantId,
      workspaceId: query.workspaceId as WorkspaceId | undefined,
      limit: Number.isFinite(limit) && limit !== undefined ? limit : undefined,
    });
    if (!result.ok) {
      return reply.code(500).send({
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Could not list activity',
          requestId: request.id,
        },
      });
    }
    return { activity: result.value.activity };
  });

  // Real-time stream: one authenticated SSE connection, filtered server-side
  // to the authenticated recipient. The NotificationStream is the transport
  // seam; the consumer publishes onto it as notifications are created.
  app.get('/api/notifications/stream', async (request, reply) => {
    const auth = requireAuth(request);
    const query = request.query as { organizationId?: string; workspaceId?: string };
    // `auth.tenantId` is the identity bootstrap tenant (`tnt_platform`), NOT
    // the caller's organization — the real tenant is resolved from trusted
    // membership, exactly like every other endpoint in this file. Without
    // this, the activity filter below (`item.tenantId === <bootstrap>`) never
    // matched and the live activity feed silently never streamed.
    const tenantId = await resolveTenant(dependencies, auth.userId, query.organizationId);

    // Activity is authorized exactly like `GET /api/activity` (see
    // `ActivityStreamScope`). Notifications are recipient-scoped and unchanged.
    const activityScope = await resolveActivityStreamScope(
      dependencies,
      auth.userId,
      tenantId,
      query.workspaceId,
    );

    reply.hijack();
    const raw = reply.raw;
    raw.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
    });
    raw.write(formatSse('ready', { status: 'connected' }));

    /** Write an SSE frame, swallowing a write after the client disconnected. */
    const safeWrite = (frame: string): void => {
      if (raw.writableEnded || raw.destroyed) {
        return;
      }
      try {
        raw.write(frame);
      } catch {
        // The socket closed between the writable check and the write —
        // `request.raw`'s `close` handler will unsubscribe.
      }
    };

    // The stream must not outlive the session that authorized it (AUTH-002).
    // The session was validated once, above (`requireAuth`); from here the
    // session id is re-checked, read-only (no touch — see `isSessionLive`):
    //   1. BEFORE every frame that would be delivered, so nothing is written
    //      after logout / revocation / expiry; the check is one primary-key
    //      lookup per DELIVERABLE event (filtered-out events cost nothing);
    //   2. on a bounded timer, so a stream with no traffic is still closed
    //      (and its socket, timer and subscription released) shortly after the
    //      session ends instead of lingering until the client disconnects.
    // A failed check (invalid session OR a lookup error) fails closed.
    const sessionId = auth.sessionId;
    let terminated = false;
    let timer: NodeJS.Timeout | undefined;
    let unsubscribe: () => void = () => undefined;
    const cleanup = (): void => {
      terminated = true;
      if (timer !== undefined) {
        clearInterval(timer);
        timer = undefined;
      }
      unsubscribe();
    };
    const terminate = (): void => {
      cleanup();
      if (!raw.writableEnded && !raw.destroyed) {
        raw.end();
      }
    };
    const stillAuthorized = async (): Promise<boolean> => {
      try {
        return await dependencies.isSessionLive(sessionId);
      } catch {
        return false;
      }
    };
    // Deliverable frames are checked and written strictly in arrival order.
    let delivery: Promise<void> = Promise.resolve();
    const deliver = (name: string, payload: unknown): void => {
      delivery = delivery.then(async () => {
        if (terminated) {
          return;
        }
        if (!(await stillAuthorized())) {
          terminate();
          return;
        }
        if (!terminated) {
          safeWrite(formatSse(name, payload));
        }
      });
    };

    unsubscribe = dependencies.stream.subscribe((event) => {
      // Server-side filtering: only the authenticated recipient's own
      // notifications, and activity scoped to the caller's RESOLVED tenant
      // (never the identity bootstrap tenant — see `isActivityInScope`).
      if (
        event.kind === 'notification' &&
        isNotificationForRecipient(event.notification.recipientId, auth.userId)
      ) {
        deliver('notification', Notification.snapshot(event.notification));
      }
      if (event.kind === 'activity' && isActivityVisibleToStream(event.item, activityScope)) {
        deliver('activity', ActivityItem.snapshot(event.item));
      }
    });

    timer = setInterval(() => {
      void stillAuthorized().then((live) => {
        if (!live && !terminated) {
          terminate();
        }
      });
    }, SSE_SESSION_RECHECK_MS);
    // Never keep the process alive for a stream timer.
    timer.unref();

    request.raw.on('close', () => {
      cleanup();
      if (!raw.writableEnded) {
        raw.end();
      }
    });
    return reply;
  });
}
