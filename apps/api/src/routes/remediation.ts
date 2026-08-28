/**
 * @nexora/app-api — governed remediation console routes (Phase 10).
 *
 * The HTTP surface over the GENERIC remediation engine:
 *
 * - `POST /api/problems/:problemId/plans` — create a remediation plan for a
 *   problem (dynamic derivation from the applicable known solution + the
 *   caller's agent capability set; server-validated VALID or BLOCKED).
 * - `POST /api/plans/:planId/advance` — execute the next step (one at a
 *   time) through the EXISTING governed execution path; a step awaiting
 *   approval opens ONE approval and waits (decisions via the existing
 *   `/api/ai/approvals/:id/decision` surface).
 * - `POST /api/plans/:planId/replan` — re-derive the plan from the CURRENT
 *   problem state (bounded; explicit REPLANNING state).
 * - `POST /api/plans/:planId/cancel` — cancel the plan (human decision;
 *   the problem stays open).
 * - `GET /api/plans` — list the scope's plans (bounded, newest first).
 * - `GET /api/plans/:planId` — one plan by id.
 *
 * Security contract (Phase 10): tenant/workspace/role/capability/approver
 * are resolved from the trusted membership scope + the SAME membership →
 * role → agent seam as every other surface. A forged plan/problem id from
 * another tenant/workspace resolves to 404 — never a leak. The client is
 * authoritative for NOTHING.
 */

import type { FastifyInstance, FastifySchema } from 'fastify';
import type { TenantId, UserId } from '@nexora/contracts/common';
import type { ListOrganizationsHandler } from '@nexora/application-organizations';
import type { ListMyWorkspacesHandler } from '@nexora/application-workspaces';
import type { RemediationSurface } from '../remediation/build.js';

import { requireAuth } from '../plugins/auth.js';
import {
  authorizePermission,
  type PermissionResolverDependencies,
} from '../business-context/permissions.js';
import { sendForbidden } from './permission-response.js';

/** Dependencies of the remediation console routes. */
export interface RemediationRoutesDependencies {
  /** The composed remediation surface. */
  remediation: RemediationSurface;
  /** Resolves the caller's organization memberships (tenant scope). */
  listOrganizations: ListOrganizationsHandler;
  /** Verifies workspace membership (workspace scope). */
  listMyWorkspaces: ListMyWorkspacesHandler;
  /**
   * RBAC permission resolution — driving a remediation plan (create /
   * advance / replan / cancel) requires `problems.investigate`, the same
   * capability that unlocks a problem's investigation. The existing
   * domain-level capability-escalation check on `advance` stays as
   * defense-in-depth.
   */
  permissions: PermissionResolverDependencies;
}

/** The create-plan body schema. */
const createPlanSchema: FastifySchema = {
  body: {
    type: 'object',
    additionalProperties: false,
    properties: {
      solutionId: { type: 'string', minLength: 1, maxLength: 128 },
    },
  },
  params: {
    type: 'object',
    required: ['problemId'],
    additionalProperties: false,
    properties: { problemId: { type: 'string', minLength: 1, maxLength: 64 } },
  },
};

/** The plan-id params schema. */
const planParamsSchema: FastifySchema = {
  params: {
    type: 'object',
    required: ['planId'],
    additionalProperties: false,
    properties: { planId: { type: 'string', minLength: 1, maxLength: 64 } },
  },
};

/** Registers the remediation console routes. */
export function registerRemediationRoutes(
  app: FastifyInstance,
  dependencies: RemediationRoutesDependencies,
): void {
  app.get('/api/plans', async (request, reply) => {
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
    const plans = await dependencies.remediation.list({
      userId: auth.userId,
      tenantId: scope.tenantId,
      workspaceId: scope.workspaceId,
    });
    return { plans };
  });

  app.get('/api/plans/:planId', { schema: planParamsSchema }, async (request, reply) => {
    const auth = requireAuth(request);
    const { planId } = request.params as { planId: string };
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
    const plan = await dependencies.remediation.getById(
      { userId: auth.userId, tenantId: scope.tenantId, workspaceId: scope.workspaceId },
      planId,
    );
    if (plan === undefined) {
      // Forged or foreign plan ids resolve to 404 — never a leak.
      return reply.code(404).send({
        error: { code: 'NOT_FOUND', message: 'Plan not found', requestId: request.id },
      });
    }
    return { plan };
  });

  app.post('/api/plans/:planId/advance', { schema: planParamsSchema }, async (request, reply) => {
    const auth = requireAuth(request);
    const { planId } = request.params as { planId: string };
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
      'problems.investigate',
    );
    if (!authz.ok) {
      return sendForbidden(reply, request.id, 'drive problem remediation');
    }
    const result = await dependencies.remediation.advance(
      { userId: auth.userId, tenantId: scope.tenantId, workspaceId: scope.workspaceId },
      planId,
    );
    if (!result.ok) {
      // A forged/foreign plan id, a non-runnable plan, or a capability
      // escalation — all fail closed with an explicit reason (never a leak).
      const status = result.reason === 'capability-escalation' ? 403 : 409;
      return reply.code(status).send({
        error: {
          code:
            result.reason === 'capability-escalation'
              ? 'CAPABILITY_ESCALATION'
              : 'PLAN_NOT_RUNNABLE',
          message: remediationFailureMessage(result.reason),
          requestId: request.id,
        },
      });
    }
    return { plan: result.plan, stepId: result.stepId, outcome: result.outcome };
  });

  app.post('/api/plans/:planId/replan', { schema: planParamsSchema }, async (request, reply) => {
    const auth = requireAuth(request);
    const { planId } = request.params as { planId: string };
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
      'problems.investigate',
    );
    if (!authz.ok) {
      return sendForbidden(reply, request.id, 'drive problem remediation');
    }
    const result = await dependencies.remediation.replan(
      { userId: auth.userId, tenantId: scope.tenantId, workspaceId: scope.workspaceId },
      planId,
    );
    if (!result.ok) {
      return reply.code(result.reason === 'no-plan' ? 404 : 409).send({
        error: {
          code: result.reason === 'no-plan' ? 'NOT_FOUND' : 'PLAN_NOT_REPLANNABLE',
          message: remediationFailureMessage(result.reason),
          requestId: request.id,
        },
      });
    }
    return { plan: result.plan };
  });

  app.post('/api/plans/:planId/cancel', { schema: planParamsSchema }, async (request, reply) => {
    const auth = requireAuth(request);
    const { planId } = request.params as { planId: string };
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
      'problems.investigate',
    );
    if (!authz.ok) {
      return sendForbidden(reply, request.id, 'drive problem remediation');
    }
    const result = await dependencies.remediation.cancel(
      { userId: auth.userId, tenantId: scope.tenantId, workspaceId: scope.workspaceId },
      planId,
    );
    if (!result.ok) {
      return reply.code(result.reason === 'no-plan' ? 404 : 409).send({
        error: {
          code: result.reason === 'no-plan' ? 'NOT_FOUND' : 'PLAN_NOT_CANCELLABLE',
          message: remediationFailureMessage(result.reason),
          requestId: request.id,
        },
      });
    }
    return { plan: result.plan };
  });

  app.post(
    '/api/problems/:problemId/plans',
    { schema: createPlanSchema },
    async (request, reply) => {
      const auth = requireAuth(request);
      const { problemId } = request.params as { problemId: string };
      const body = (request.body ?? {}) as { solutionId?: string };
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
        'problems.investigate',
      );
      if (!authz.ok) {
        return sendForbidden(reply, request.id, 'drive problem remediation');
      }
      const result = await dependencies.remediation.createPlan(
        { userId: auth.userId, tenantId: scope.tenantId, workspaceId: scope.workspaceId },
        {
          problemId,
          ...(body.solutionId === undefined ? {} : { solutionId: body.solutionId }),
        },
      );
      if (!result.ok) {
        const status = result.reason === 'no-problem' || result.reason === 'no-role' ? 404 : 409;
        return reply.code(status).send({
          error: {
            code: remediationReasonCode(result.reason),
            message: remediationFailureMessage(result.reason),
            requestId: request.id,
          },
        });
      }
      return { plan: result.plan };
    },
  );
}

/** Maps an internal remediation failure reason to a client-safe message. */
function remediationFailureMessage(reason: string): string {
  switch (reason) {
    case 'no-plan':
      return 'Plan not found';
    case 'no-problem':
      return 'Problem not found';
    case 'no-role':
      return 'No business role resolves for this caller';
    case 'no-agent':
      return 'No business agent resolves for this caller';
    case 'no-solution':
      return 'No applicable known solution found — the plan cannot be built';
    case 'problem-resolved':
      return 'The problem is already resolved';
    case 'not-runnable':
      return 'The plan is not runnable right now (another step is in flight or the state changed)';
    case 'capability-escalation':
      return 'The step requires a capability outside your current agent set';
    case 'not-configured':
      return 'The remediation surface is not configured for execution';
    case 'not-replannable':
      return 'The plan cannot be re-planned in its current state';
    case 'replan-limit':
      return 'The re-plan limit was reached — human intervention required';
    case 'approval-rejected':
      return 'A required approval was rejected — remediation stopped';
    default:
      return 'The remediation could not proceed';
  }
}

/** Maps an internal create-plan failure reason to a client-safe code. */
function remediationReasonCode(reason: string): string {
  switch (reason) {
    case 'no-problem':
    case 'no-role':
      return 'NOT_FOUND';
    case 'no-solution':
      return 'NO_SOLUTION';
    case 'problem-resolved':
      return 'PROBLEM_RESOLVED';
    case 'no-agent':
      return 'NO_AGENT';
    default:
      return 'PLAN_NOT_CREATED';
  }
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
  dependencies: RemediationRoutesDependencies,
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
