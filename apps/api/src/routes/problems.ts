/**
 * @nexora/app-api — proactive detection problems console routes (S27).
 *
 * The dedicated problems console surface, fed by the SAME detection engine
 * that feeds the agent DTO:
 *
 * - `GET /api/problems` — list the caller's detected problems (full
 *   investigation: evidence, root-cause candidates, discovered solutions,
 *   deterministic recommendation). No re-evaluation — a fast read.
 * - `POST /api/problems/scan` — run a full detection scan for the trusted
 *   scope and return the refreshed list (idempotent by correlation
 *   identity: re-scans update one problem, never duplicates).
 * - `GET /api/problems/:problemId` — one problem by id (tenant-scoped; a
 *   forged or foreign id resolves to 404 — fail closed).
 *
 * Security contract (the same model as every other surface):
 * - The tenant (organization) is resolved from TRUSTED organization
 *   membership (listOrganizations) — never from a client-supplied value.
 * - The optional workspace is verified against the membership-scoped
 *   workspace read model (listMyWorkspaces) — a forged or foreign workspace
 *   resolves to 403, never to another workspace's problems.
 * - Problem-derived action proposals are bounded to the caller's EFFECTIVE
 *   agent capability set (resolved through the same membership → role →
 *   agent seam the agent DTO uses). A caller without an agent gets the
 *   full investigation but never an action proposal (fail closed — the
 *   console can never recommend an action beyond what the caller's agent
 *   could actually execute).
 */

import type { FastifyInstance, FastifySchema } from 'fastify';
import type { TenantId, UserId } from '@nexora/contracts/common';
import type { ListOrganizationsHandler } from '@nexora/application-organizations';
import type { ListMyWorkspacesHandler } from '@nexora/application-workspaces';
import type { GetBusinessAgentCapabilitiesHandler } from '@nexora/module-agents';
import type {
  GetProblemHandler,
  ListProblemsHandler,
  ScanProblemsHandler,
} from '@nexora/module-detection';

import { requireAuth } from '../plugins/auth.js';

/** Dependencies of the problems console routes. */
export interface ProblemsRoutesDependencies {
  /** Runs a full detection scan for the trusted scope (idempotent). */
  scan: ScanProblemsHandler;
  /** Lists the scope's problems without re-evaluating signals. */
  list: ListProblemsHandler;
  /** Resolves one problem by id (tenant-scoped). */
  getById: GetProblemHandler;
  /**
   * Resolves the caller's effective agent capability set — with NONE of the
   * DTO side effects (a full agent resolve would re-run the detection
   * problem-provider scan, which would make even a plain list re-evaluate
   * signals).
   */
  getAgentCapabilities: GetBusinessAgentCapabilitiesHandler;
  /** Resolves the caller's organization memberships (tenant scope). */
  listOrganizations: ListOrganizationsHandler;
  /** Verifies workspace membership (workspace scope). */
  listMyWorkspaces: ListMyWorkspacesHandler;
}

/** The get-one-problem params schema. */
const getProblemSchema: FastifySchema = {
  params: {
    type: 'object',
    required: ['problemId'],
    additionalProperties: false,
    properties: { problemId: { type: 'string', minLength: 1, maxLength: 64 } },
  },
};

/** Registers the problems console routes. */
export function registerProblemsRoutes(
  app: FastifyInstance,
  dependencies: ProblemsRoutesDependencies,
): void {
  app.get('/api/problems', async (request, reply) => {
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

    const problems = await dependencies.list.handle({
      userId: auth.userId,
      tenantId: scope.tenantId as TenantId,
      workspaceId: scope.workspaceId,
      agentCapabilityIds: await resolveAgentCapabilities(dependencies, auth.userId, scope),
    });
    return { problems };
  });

  app.post('/api/problems/scan', async (request, reply) => {
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

    const result = await dependencies.scan.handle({
      userId: auth.userId,
      tenantId: scope.tenantId as TenantId,
      workspaceId: scope.workspaceId,
      agentCapabilityIds: await resolveAgentCapabilities(dependencies, auth.userId, scope),
    });
    if (!result.ok) {
      return reply.code(503).send({
        error: {
          code: 'SERVICE_UNAVAILABLE',
          message: 'Could not build the trusted detection snapshot',
          requestId: request.id,
        },
      });
    }
    return { problems: result.problems };
  });

  app.get('/api/problems/:problemId', { schema: getProblemSchema }, async (request, reply) => {
    const auth = requireAuth(request);
    const { problemId } = request.params as { problemId: string };
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

    const problem = await dependencies.getById.handle(
      {
        userId: auth.userId,
        tenantId: scope.tenantId as TenantId,
        workspaceId: scope.workspaceId,
        agentCapabilityIds: await resolveAgentCapabilities(dependencies, auth.userId, scope),
      },
      problemId,
    );
    if (problem === undefined) {
      // Forged or foreign problem ids resolve to 404 — never a leak, never
      // an enumeration oracle.
      return reply.code(404).send({
        error: { code: 'NOT_FOUND', message: 'Problem not found', requestId: request.id },
      });
    }
    return { problem };
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
  dependencies: ProblemsRoutesDependencies,
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

/**
 * Resolves the caller's effective agent capability set (fail safe: a caller
 * without an agent gets an empty set — the console then never produces an
 * action proposal, only the investigation). The SAME membership → role →
 * agent seam the agent DTO uses; a client-supplied role/agent is never
 * consulted.
 */
async function resolveAgentCapabilities(
  dependencies: ProblemsRoutesDependencies,
  userId: UserId,
  scope: { tenantId: string; workspaceId?: string; error?: undefined },
): Promise<readonly string[]> {
  const result = await dependencies.getAgentCapabilities.handle({
    userId,
    tenantId: scope.tenantId as TenantId,
    workspaceId: scope.workspaceId,
  });
  return result.ok ? result.capabilityIds : [];
}
