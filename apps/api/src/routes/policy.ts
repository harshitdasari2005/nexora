/**
 * @nexora/app-api — Policy Administration routes (Prompt 8).
 *
 * `GET  /api/policy/policies`                       (policy.read)
 * `GET  /api/policy/policies/:policyId/history`     (policy.read)
 * `POST /api/policy/policies/:policyId/versions`    (policy.manage)
 *
 * Security contract (the SAME model as the Audit Center):
 * 1. organization membership, 2. workspace membership, 3. RBAC capability via
 * `authorizePermission`. A caller without the capability gets 403 and the
 * attempt is audited (`policy.admin_denied`, after scope membership was
 * verified so a forged scope can never write into another tenant's feed).
 * Data is tenant-scoped. Configuration is validated (strict allow-list)
 * BEFORE anything is written; rejections never echo values.
 *
 * These routes are HUMAN-ONLY: `policy.read` / `policy.manage` are
 * non-delegable and appear on no AI tool, MCP tool or agent capability.
 */

import type { FastifyInstance, FastifyReply } from 'fastify';
import type { TenantId, UserId } from '@nexora/contracts/common';
import type { ListOrganizationsHandler } from '@nexora/application-organizations';
import type { ListMyWorkspacesHandler } from '@nexora/application-workspaces';

import { requireAuth } from '../plugins/auth.js';
import {
  authorizePermission,
  type PermissionResolverDependencies,
} from '../business-context/permissions.js';
import { sendForbidden } from './permission-response.js';
import {
  POLICY_REASON_MAX_LENGTH,
  type PolicyAdminService,
} from '../policy/policy-admin-service.js';

/** Dependencies of the policy administration routes. */
export interface PolicyRoutesDependencies {
  policyAdmin: PolicyAdminService;
  listOrganizations: ListOrganizationsHandler;
  listMyWorkspaces: ListMyWorkspacesHandler;
  permissions: PermissionResolverDependencies;
}

interface ScopeQuery {
  organizationId?: string;
  workspaceId?: string;
}

async function authorizeScope(
  dependencies: PolicyRoutesDependencies,
  userId: string,
  organizationId: string,
  workspaceId: string,
): Promise<string | undefined> {
  const membership = await dependencies.listOrganizations.handle({ userId: userId as UserId });
  if (!membership.ok || !membership.value.some((org) => org.id === organizationId)) {
    return 'You are not a member of this organization';
  }
  const workspaces = await dependencies.listMyWorkspaces.handle({
    userId: userId as UserId,
    organizationId: organizationId as TenantId,
  });
  if (!workspaces.ok || !workspaces.value.some((workspace) => workspace.id === workspaceId)) {
    return 'You are not a member of this workspace';
  }
  return undefined;
}

function sendError(
  reply: FastifyReply,
  status: number,
  code: string,
  message: string,
  requestId: string,
  extra: Record<string, unknown> = {},
): unknown {
  return reply.code(status).send({ error: { code, message, requestId, ...extra } });
}

const BODY_KEYS: ReadonlySet<string> = new Set(['config', 'enabled', 'reason', 'expectedVersion']);

/** Registers the policy administration routes. */
export function registerPolicyRoutes(
  app: FastifyInstance,
  dependencies: PolicyRoutesDependencies,
): void {
  /**
   * Shared guard: scope membership, then the RBAC capability. Returns the
   * verified scope, or `undefined` after sending the failure response.
   */
  async function authorizePolicyRoute(
    request: { id: string; query: unknown; params: unknown },
    reply: FastifyReply,
    userId: string,
    capability: 'policy.read' | 'policy.manage',
  ): Promise<{ organizationId: string; workspaceId: string } | undefined> {
    const query = request.query as ScopeQuery;
    if (query.organizationId === undefined || query.workspaceId === undefined) {
      sendError(
        reply,
        400,
        'VALIDATION_ERROR',
        'Missing required query parameters: organizationId, workspaceId',
        request.id,
      );
      return undefined;
    }
    const denial = await authorizeScope(
      dependencies,
      userId,
      query.organizationId,
      query.workspaceId,
    );
    if (denial !== undefined) {
      sendError(reply, 403, 'AUTHORIZATION_ERROR', denial, request.id);
      return undefined;
    }
    const authz = await authorizePermission(
      dependencies.permissions,
      { userId, tenantId: query.organizationId, workspaceId: query.workspaceId },
      capability,
    );
    if (!authz.ok) {
      const policyId = (request.params as { policyId?: string } | undefined)?.policyId;
      await dependencies.policyAdmin.recordDenied({
        organizationId: query.organizationId,
        workspaceId: query.workspaceId,
        actorId: userId,
        action: capability === 'policy.read' ? 'read' : 'manage',
        requiredCapability: capability,
        ...(policyId === undefined || policyId.length > 96 ? {} : { policyId }),
        correlationId: request.id,
      });
      sendForbidden(
        reply,
        request.id,
        capability === 'policy.read' ? 'view policies' : 'manage policies',
      );
      return undefined;
    }
    return { organizationId: query.organizationId, workspaceId: query.workspaceId };
  }

  app.get('/api/policy/policies', async (request, reply) => {
    const auth = requireAuth(request);
    const scope = await authorizePolicyRoute(request, reply, auth.userId, 'policy.read');
    if (scope === undefined) return reply;
    return { policies: await dependencies.policyAdmin.list(scope.organizationId) };
  });

  app.get('/api/policy/policies/:policyId/history', async (request, reply) => {
    const auth = requireAuth(request);
    const scope = await authorizePolicyRoute(request, reply, auth.userId, 'policy.read');
    if (scope === undefined) return reply;
    const { policyId } = request.params as { policyId: string };
    const versions = await dependencies.policyAdmin.history(scope.organizationId, policyId);
    if (versions === undefined) {
      return sendError(reply, 404, 'NOT_FOUND', 'Policy not found', request.id);
    }
    return { policyId, versions };
  });

  app.post('/api/policy/policies/:policyId/versions', async (request, reply) => {
    const auth = requireAuth(request);
    const scope = await authorizePolicyRoute(request, reply, auth.userId, 'policy.manage');
    if (scope === undefined) return reply;
    const { policyId } = request.params as { policyId: string };

    const body = request.body as unknown;
    if (typeof body !== 'object' || body === null || Array.isArray(body)) {
      return sendError(
        reply,
        400,
        'VALIDATION_ERROR',
        'A JSON object body is required',
        request.id,
      );
    }
    const record = body as Record<string, unknown>;
    if (Object.keys(record).some((key) => !BODY_KEYS.has(key))) {
      return sendError(
        reply,
        400,
        'VALIDATION_ERROR',
        'The body contains an unknown field',
        request.id,
      );
    }
    const { config, enabled, reason, expectedVersion } = record;
    if (enabled !== undefined && typeof enabled !== 'boolean') {
      return sendError(reply, 400, 'VALIDATION_ERROR', '"enabled" must be a boolean', request.id);
    }
    if (
      reason !== undefined &&
      (typeof reason !== 'string' || reason.length > POLICY_REASON_MAX_LENGTH)
    ) {
      return sendError(
        reply,
        400,
        'VALIDATION_ERROR',
        `"reason" must be a string of at most ${POLICY_REASON_MAX_LENGTH} characters`,
        request.id,
      );
    }
    if (
      expectedVersion !== undefined &&
      (typeof expectedVersion !== 'number' ||
        !Number.isInteger(expectedVersion) ||
        expectedVersion < 0)
    ) {
      return sendError(
        reply,
        400,
        'VALIDATION_ERROR',
        '"expectedVersion" must be a non-negative integer',
        request.id,
      );
    }
    if (config === undefined && enabled === undefined) {
      return sendError(
        reply,
        400,
        'VALIDATION_ERROR',
        'Send a "config" and/or an "enabled" value',
        request.id,
      );
    }

    const result = await dependencies.policyAdmin.createVersion({
      organizationId: scope.organizationId,
      workspaceId: scope.workspaceId,
      actorId: auth.userId,
      policyId,
      ...(config === undefined ? {} : { config }),
      ...(enabled === undefined ? {} : { enabled }),
      ...(reason === undefined ? {} : { reason: reason.trim() }),
      ...(expectedVersion === undefined ? {} : { expectedVersion }),
      correlationId: request.id,
    });
    if (result.ok) {
      return reply.code(201).send({ version: result.version });
    }
    switch (result.code) {
      case 'NOT_FOUND':
        return sendError(reply, 404, 'NOT_FOUND', 'Policy not found', request.id);
      case 'NOT_CONFIGURABLE':
        return sendError(
          reply,
          422,
          'POLICY_NOT_CONFIGURABLE',
          'This policy is managed by the platform and cannot be configured',
          request.id,
        );
      case 'CONFIG_INVALID':
        return sendError(
          reply,
          422,
          'POLICY_CONFIG_INVALID',
          'The policy configuration is not valid',
          request.id,
          { errors: result.errors },
        );
      case 'VERSION_CONFLICT':
        return sendError(
          reply,
          409,
          'POLICY_VERSION_CONFLICT',
          'The policy changed since it was read; reload and retry',
          request.id,
          { currentVersion: result.currentVersion },
        );
    }
  });
}
