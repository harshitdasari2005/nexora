/**
 * @nexora/app-api — Audit Center routes.
 *
 * `GET /api/audit/events` — the unified, read-only view over four EXISTING
 * journals (`AuditQueryService`): agent executions, approval decisions,
 * workflow step outcomes, and business activity. This route adds no new
 * write path and no new data — it only reads what other features already
 * persist as a normal part of doing their job.
 *
 * Security contract (the SAME model as every other surface):
 * 1. Organization membership — the caller must be a member of the
 *    organization (tenant scope).
 * 2. Workspace membership — the caller must be a member of the target
 *    workspace (workspace scope) — this is the scope the caller's
 *    `audit.read` capability is resolved against.
 * 3. RBAC capability — `audit.read`, via the SAME `authorizePermission`
 *    every other RBAC'd surface uses. Only `executive.ceo`,
 *    `legal.general_counsel`, and `legal.compliance_manager` hold it today
 *    (P0-equivalent design: a role without the capability is rejected with
 *    403 even though it belongs to the tenant/workspace — never a silent
 *    membership-only fallback).
 *
 * Once authorized, the DATA returned spans the whole tenant (not just the
 * caller's current workspace) — the point of an audit trail is a unified
 * cross-module view ("across Nexora"), not a per-workspace one. An
 * optional `filterWorkspaceId` query param narrows the results to one
 * workspace without affecting the authorization anchor above.
 */

import type { FastifyInstance } from 'fastify';
import type { TenantId, UserId, WorkspaceId } from '@nexora/contracts/common';
import type { ListOrganizationsHandler } from '@nexora/application-organizations';
import type { ListMyWorkspacesHandler } from '@nexora/application-workspaces';

import { requireAuth } from '../plugins/auth.js';
import {
  authorizePermission,
  type PermissionResolverDependencies,
} from '../business-context/permissions.js';
import { sendForbidden } from './permission-response.js';
import type {
  AuditEventFilters,
  AuditEventSource,
  AuditQueryService,
} from '../audit/audit-query-service.js';

const VALID_SOURCES: readonly AuditEventSource[] = [
  'agent_execution',
  'approval',
  'workflow_step',
  'activity',
];

/** Dependencies of the audit routes. */
export interface AuditRoutesDependencies {
  auditQuery: AuditQueryService;
  listOrganizations: ListOrganizationsHandler;
  listMyWorkspaces: ListMyWorkspacesHandler;
  /** RBAC: the SAME trusted role resolver + catalog every surface uses. */
  permissions: PermissionResolverDependencies;
}

/**
 * Verifies the caller is a member of the organization AND the workspace
 * (two independent trusted read models — a forged scope fails closed).
 */
async function authorizeScope(
  dependencies: AuditRoutesDependencies,
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

/** Reads and validates the `source` query filter, ignoring an unknown value. */
function readSourceFilter(value: unknown): AuditEventSource | undefined {
  return typeof value === 'string' && (VALID_SOURCES as readonly string[]).includes(value)
    ? (value as AuditEventSource)
    : undefined;
}

/** Registers the Audit Center routes. */
export function registerAuditRoutes(
  app: FastifyInstance,
  dependencies: AuditRoutesDependencies,
): void {
  app.get('/api/audit/events', async (request, reply) => {
    const auth = requireAuth(request);
    const query = request.query as {
      organizationId?: string;
      workspaceId?: string;
      filterWorkspaceId?: string;
      source?: string;
      status?: string;
      actorId?: string;
      from?: string;
      to?: string;
      q?: string;
      limit?: string;
    };
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

    const authz = await authorizePermission(
      dependencies.permissions,
      { userId: auth.userId, tenantId: query.organizationId, workspaceId: query.workspaceId },
      'audit.read',
    );
    if (!authz.ok) {
      return sendForbidden(reply, request.id, 'view the audit trail');
    }

    // A `filterWorkspaceId` narrows the returned DATA to one workspace; it
    // is never the authorization anchor above (that is always the caller's
    // own trusted `workspaceId`). It is NOT independently membership- or
    // capability-checked — it only narrows a result set the caller is
    // already authorized (tenant-wide) to see, so a forged value can widen
    // nothing: at most it returns zero rows for a workspace outside the
    // tenant.
    const dataWorkspaceId =
      typeof query.filterWorkspaceId === 'string' && query.filterWorkspaceId.length > 0
        ? query.filterWorkspaceId
        : undefined;

    const limitRaw = query.limit === undefined ? undefined : Number(query.limit);
    const limit =
      limitRaw !== undefined && Number.isFinite(limitRaw) && limitRaw > 0
        ? Math.min(limitRaw, 500)
        : undefined;

    const filters: AuditEventFilters = {
      source: readSourceFilter(query.source),
      status: query.status,
      actorId: query.actorId,
      from: query.from,
      to: query.to,
      q: query.q,
    };

    const events = await dependencies.auditQuery.listEvents(
      {
        tenantId: query.organizationId as TenantId,
        workspaceId: dataWorkspaceId as WorkspaceId | undefined,
      },
      filters,
      limit,
    );
    return { events };
  });
}
