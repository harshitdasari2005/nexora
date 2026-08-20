/**
 * @nexora/app-api — business-agent routes (S26 Phase 8).
 *
 * `GET /api/agent` — the current user's governed business agent. The server
 * resolves everything from TRUSTED context: the tenant (organization) from
 * authenticated membership, the optional workspace verified against
 * membership, and the effective business role from membership (never from
 * URL/query/body/AI/frontend state).
 *
 * `POST /api/agent/proposals/:proposalId/execute` — execute a governed
 * proposal through the EXISTING AI Runtime. The proposal is RE-DERIVED from
 * real persisted data server-side (a forged or stale id resolves to 404),
 * its required capability is validated to be inside the agent's registered
 * set (a capability escalation resolves to 403 — fail closed), and the run
 * is restricted to that single capability. Write proposals surface an
 * approval gate decided through the EXISTING approval surface.
 *
 * `POST /api/agent/execute` — execute a free-form intent bound to the
 * agent's ENTIRE registered capability set (the user can never reach a
 * capability outside it).
 *
 * Security contract (the same model as every other surface):
 * - `?organizationId=` is validated against the caller's memberships.
 * - `?workspaceId=` is verified against the membership-scoped workspace
 *   read model — a forged or foreign workspace resolves to 403.
 * - `?role=` / `?domain=` / `?agentId=` are IGNORED: the effective role and
 *   the bound agent are derived from trusted membership only.
 * - The agent can never self-grant: execution capabilities come from the
 *   agent's registered set, never from the request.
 */

import type { FastifyInstance, FastifySchema } from 'fastify';
import type { TenantId, UserId } from '@nexora/contracts/common';
import type { ListOrganizationsHandler } from '@nexora/application-organizations';
import type { ListMyWorkspacesHandler } from '@nexora/application-workspaces';
import type { ExecuteBusinessAgentHandler, GetBusinessAgentHandler } from '@nexora/module-agents';

import { requireAuth } from '../plugins/auth.js';
import {
  authorizePermission,
  type PermissionResolverDependencies,
} from '../business-context/permissions.js';
import { sendForbidden } from './permission-response.js';

/** Dependencies of the business-agent routes. */
export interface AgentRoutesDependencies {
  /** The business-agent query handler (generic engine). */
  getAgent: GetBusinessAgentHandler;
  /** The governed execution handler (generic engine). */
  executeAgent: ExecuteBusinessAgentHandler;
  /** Resolves the caller's organization memberships (tenant scope). */
  listOrganizations: ListOrganizationsHandler;
  /** Verifies workspace membership (workspace scope). */
  listMyWorkspaces: ListMyWorkspacesHandler;
  /** RBAC: the SAME trusted role resolver + catalog every surface uses. */
  permissions: PermissionResolverDependencies;
}

/** The proposal-execution params schema. */
const executeProposalSchema: FastifySchema = {
  params: {
    type: 'object',
    required: ['proposalId'],
    additionalProperties: false,
    properties: { proposalId: { type: 'string', minLength: 1 } },
  },
};

/** The free-form execution body schema. */
const executeSchema: FastifySchema = {
  body: {
    type: 'object',
    required: ['utterance'],
    additionalProperties: false,
    properties: { utterance: { type: 'string', minLength: 1, maxLength: 4000 } },
  },
};

/** Registers the business-agent routes. */
export function registerAgentRoutes(
  app: FastifyInstance,
  dependencies: AgentRoutesDependencies,
): void {
  app.get('/api/agent', async (request, reply) => {
    const auth = requireAuth(request);
    const query = request.query as { organizationId?: string; workspaceId?: string };

    const scope = await resolveTrustedScope(
      dependencies,
      auth.userId,
      query.organizationId,
      query.workspaceId,
    );
    if (scope.error !== undefined) {
      return reply.code(scope.error.status).send(scope.error.body);
    }
    const authz = await authorizePermission(
      dependencies.permissions,
      { userId: auth.userId, tenantId: scope.tenantId, workspaceId: scope.workspaceId },
      'agent.use',
    );
    if (!authz.ok) {
      return sendForbidden(reply, request.id, 'view the business agent');
    }

    const result = await dependencies.getAgent.handle({
      userId: auth.userId,
      tenantId: scope.tenantId as TenantId,
      workspaceId: scope.workspaceId,
    });
    if (!result.ok) {
      // Fails safely: no agent is registered for the caller's effective
      // role (or the caller has no business role at all).
      return reply.code(404).send({
        error: {
          code: 'NOT_FOUND',
          message: 'No agent is configured for your role',
          requestId: request.id,
        },
      });
    }
    return result.agent;
  });

  app.post(
    '/api/agent/proposals/:proposalId/execute',
    { schema: executeProposalSchema },
    async (request, reply) => {
      const auth = requireAuth(request);
      const { proposalId } = request.params as { proposalId: string };
      const query = request.query as { organizationId?: string; workspaceId?: string };

      const scope = await resolveTrustedScope(
        dependencies,
        auth.userId,
        query.organizationId,
        query.workspaceId,
      );
      if (scope.error !== undefined) {
        return reply.code(scope.error.status).send(scope.error.body);
      }
      const authz = await authorizePermission(
        dependencies.permissions,
        { userId: auth.userId, tenantId: scope.tenantId, workspaceId: scope.workspaceId },
        'agent.execute',
      );
      if (!authz.ok) {
        return sendForbidden(reply, request.id, 'execute the business agent');
      }

      const result = await dependencies.executeAgent.handle(
        {
          userId: auth.userId,
          tenantId: scope.tenantId as TenantId,
          workspaceId: scope.workspaceId,
        },
        { proposalId },
      );
      return sendExecutionResult(reply, request.id, result);
    },
  );

  app.post('/api/agent/execute', { schema: executeSchema }, async (request, reply) => {
    const auth = requireAuth(request);
    const body = request.body as { utterance: string };
    const query = request.query as { organizationId?: string; workspaceId?: string };

    const scope = await resolveTrustedScope(
      dependencies,
      auth.userId,
      query.organizationId,
      query.workspaceId,
    );
    if (scope.error !== undefined) {
      return reply.code(scope.error.status).send(scope.error.body);
    }
    const authz = await authorizePermission(
      dependencies.permissions,
      { userId: auth.userId, tenantId: scope.tenantId, workspaceId: scope.workspaceId },
      'agent.execute',
    );
    if (!authz.ok) {
      return sendForbidden(reply, request.id, 'execute the business agent');
    }

    const result = await dependencies.executeAgent.handle(
      {
        userId: auth.userId,
        tenantId: scope.tenantId as TenantId,
        workspaceId: scope.workspaceId,
      },
      { utterance: body.utterance },
    );
    return sendExecutionResult(reply, request.id, result);
  });
}

/** A resolved trusted scope, or an error response. */
type TrustedScope =
  | { tenantId: string; workspaceId?: string; error?: undefined }
  | { error: { status: number; body: unknown }; tenantId?: undefined };

/**
 * Resolves the trusted tenant + optional workspace from authenticated
 * membership — never from client input. A forged or foreign organization or
 * workspace resolves to 403 (fail closed).
 */
async function resolveTrustedScope(
  dependencies: AgentRoutesDependencies,
  userId: UserId,
  organizationIdQuery?: string,
  workspaceIdQuery?: string,
): Promise<TrustedScope> {
  const membership = await dependencies.listOrganizations.handle({ userId });
  if (!membership.ok || membership.value.length === 0) {
    return {
      error: {
        status: 403,
        body: {
          error: {
            code: 'AUTHORIZATION_ERROR',
            message: 'You are not a member of any organization',
          },
        },
      },
    };
  }
  const tenantId =
    membership.value.find((org) => org.id === organizationIdQuery)?.id ?? membership.value[0]?.id;
  if (tenantId === undefined) {
    return {
      error: {
        status: 403,
        body: {
          error: {
            code: 'AUTHORIZATION_ERROR',
            message: 'You are not a member of any organization',
          },
        },
      },
    };
  }

  // Optional workspace scope: verified against the membership-scoped read
  // model so a forged or foreign workspace resolves to 403.
  if (workspaceIdQuery !== undefined) {
    const workspaces = await dependencies.listMyWorkspaces.handle({
      userId,
      organizationId: tenantId as TenantId,
    });
    const accessible = workspaces.ok && workspaces.value.some((ws) => ws.id === workspaceIdQuery);
    if (!accessible) {
      return {
        error: {
          status: 403,
          body: {
            error: {
              code: 'AUTHORIZATION_ERROR',
              message: 'You are not a member of this workspace',
            },
          },
        },
      };
    }
    return { tenantId, workspaceId: workspaceIdQuery };
  }
  return { tenantId };
}

/** Maps an execution result to the stable HTTP surface (fail closed). */
function sendExecutionResult(
  reply: { code(status: number): { send(body: unknown): unknown } },
  requestId: string,
  result: Awaited<ReturnType<ExecuteBusinessAgentHandler['handle']>>,
): unknown {
  if (result.ok) {
    return { agent: result.agent, outcome: result.outcome };
  }
  switch (result.reason) {
    case 'capability-escalation':
      return reply.code(403).send({
        error: {
          code: 'AUTHORIZATION_ERROR',
          message: 'The proposal requires a capability outside your agent',
          requestId,
        },
      });
    case 'no-proposal':
      return reply.code(404).send({
        error: {
          code: 'NOT_FOUND',
          message: 'Proposal not found',
          requestId,
        },
      });
    case 'not-configured':
      return reply.code(503).send({
        error: {
          code: 'SERVICE_UNAVAILABLE',
          message: 'Agent execution is not configured',
          requestId,
        },
      });
    case 'no-role':
    case 'no-agent':
      return reply.code(404).send({
        error: {
          code: 'NOT_FOUND',
          message: 'No agent is configured for your role',
          requestId,
        },
      });
  }
}
