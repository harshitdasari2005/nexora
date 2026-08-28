/**
 * @nexora/app-api — finance routes.
 *
 * The Finance REST surface for the vertical slice: budgets (create, list,
 * get, revise, close, clear-review, utilization) and expenses (submit,
 * list, get, decide). Every endpoint enforces TWO trusted server-side
 * authorization boundaries:
 *
 * 1. Organization membership — the authenticated user must be a member of
 *    the organization (tenant scope).
 * 2. Workspace membership — the authenticated user must be a member of the
 *    target workspace (workspace scope).
 *
 * A user who is a member of organization A / workspace W1 can never read,
 * create, or decide a budget/expense in workspace W2 of the same
 * organization or in another tenant. The name/description is DATA — it
 * never affects authorization.
 *
 * A SECOND boundary sits on top of scope: the caller's effective RBAC
 * capability — `budgets.read` / `expenses.read` for reads, `budgets.manage`
 * for budget writes, `expenses.create` for submitting an expense,
 * `expenses.decide` for approving/rejecting one (a real money movement,
 * BR-19 — distinct from `expenses.create`: submitting and deciding are
 * different authorities) — via the SAME `authorizePermission` every other
 * surface uses, never a second permission model. This vertical slice
 * grants every one of these capabilities to `finance.cfo` only
 * (platform/domains/src/seed/initial-definitions.ts) — Finance is a real,
 * single-owner vertical, not a company-wide read like calendar/audit.
 */

import type { FastifyInstance, FastifySchema } from 'fastify';
import type { TenantId, UserId, WorkspaceId } from '@nexora/contracts/common';
import { toBudgetDto, toExpenseDto } from '@nexora/application-finance';
import type {
  ClearBudgetReviewHandler,
  CloseBudgetHandler,
  CreateBudgetHandler,
  DecideExpenseHandler,
  FlagOverBudgetItemsHandler,
  GetBudgetHandler,
  GetExpenseHandler,
  ListBudgetUtilizationHandler,
  ListBudgetsHandler,
  ListExpensesHandler,
  ReviseBudgetHandler,
  SubmitExpenseHandler,
} from '@nexora/application-finance';
import type { ListOrganizationsHandler } from '@nexora/application-organizations';
import type { ListMyWorkspacesHandler } from '@nexora/application-workspaces';

import { requireAuth } from '../plugins/auth.js';
import {
  authorizePermission,
  type PermissionResolverDependencies,
} from '../business-context/permissions.js';
import { toHttpError } from '../http/errors.js';
import { sendForbidden } from './permission-response.js';

/** Request body schema for POST /api/finance/budgets. */
const createBudgetSchema: FastifySchema = {
  body: {
    type: 'object',
    required: [
      'organizationId',
      'workspaceId',
      'name',
      'allocatedMinorUnits',
      'currency',
      'periodStart',
      'periodEnd',
    ],
    additionalProperties: false,
    properties: {
      organizationId: { type: 'string', minLength: 1 },
      workspaceId: { type: 'string', minLength: 1 },
      name: { type: 'string', minLength: 1, maxLength: 120 },
      allocatedMinorUnits: { type: 'integer', minimum: 0 },
      currency: { type: 'string', minLength: 3, maxLength: 3 },
      periodStart: { type: 'string', minLength: 1 },
      periodEnd: { type: 'string', minLength: 1 },
    },
  },
};

/** Request body schema for PATCH /api/finance/budgets/:id. */
const reviseBudgetSchema: FastifySchema = {
  params: {
    type: 'object',
    required: ['id'],
    additionalProperties: false,
    properties: { id: { type: 'string', minLength: 1 } },
  },
  body: createBudgetSchema.body,
};

/** Request body schema for scope-only actions (close, clear-review, flag). */
const scopeOnlyBodySchema: FastifySchema = {
  body: {
    type: 'object',
    required: ['organizationId', 'workspaceId'],
    additionalProperties: false,
    properties: {
      organizationId: { type: 'string', minLength: 1 },
      workspaceId: { type: 'string', minLength: 1 },
    },
  },
};

/** Request body schema for scope-only actions with a required :id param. */
const scopeOnlyWithIdSchema: FastifySchema = {
  params: {
    type: 'object',
    required: ['id'],
    additionalProperties: false,
    properties: { id: { type: 'string', minLength: 1 } },
  },
  body: scopeOnlyBodySchema.body,
};

/** Request body schema for POST /api/finance/expenses. */
const submitExpenseSchema: FastifySchema = {
  body: {
    type: 'object',
    required: [
      'organizationId',
      'workspaceId',
      'budgetId',
      'description',
      'amountMinorUnits',
      'currency',
    ],
    additionalProperties: false,
    properties: {
      organizationId: { type: 'string', minLength: 1 },
      workspaceId: { type: 'string', minLength: 1 },
      budgetId: { type: 'string', minLength: 1 },
      description: { type: 'string', minLength: 1, maxLength: 120 },
      amountMinorUnits: { type: 'integer', minimum: 1 },
      currency: { type: 'string', minLength: 3, maxLength: 3 },
    },
  },
};

/** Request body schema for POST /api/finance/expenses/:id/decide. */
const decideExpenseSchema: FastifySchema = {
  params: {
    type: 'object',
    required: ['id'],
    additionalProperties: false,
    properties: { id: { type: 'string', minLength: 1 } },
  },
  body: {
    type: 'object',
    required: ['organizationId', 'workspaceId', 'decision'],
    additionalProperties: false,
    properties: {
      organizationId: { type: 'string', minLength: 1 },
      workspaceId: { type: 'string', minLength: 1 },
      decision: { type: 'string', enum: ['approve', 'reject'] },
    },
  },
};

/** Dependencies of the finance routes. */
export interface FinanceRoutesDependencies {
  createBudget: CreateBudgetHandler;
  reviseBudget: ReviseBudgetHandler;
  closeBudget: CloseBudgetHandler;
  clearBudgetReview: ClearBudgetReviewHandler;
  flagOverBudgetItems: FlagOverBudgetItemsHandler;
  listBudgets: ListBudgetsHandler;
  getBudget: GetBudgetHandler;
  listBudgetUtilization: ListBudgetUtilizationHandler;
  submitExpense: SubmitExpenseHandler;
  decideExpense: DecideExpenseHandler;
  listExpenses: ListExpensesHandler;
  getExpense: GetExpenseHandler;
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
  dependencies: FinanceRoutesDependencies,
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

/** Registers the finance routes. */
export function registerFinanceRoutes(
  app: FastifyInstance,
  dependencies: FinanceRoutesDependencies,
): void {
  app.post('/api/finance/budgets', { schema: createBudgetSchema }, async (request, reply) => {
    const auth = requireAuth(request);
    const body = request.body as {
      organizationId: string;
      workspaceId: string;
      name: string;
      allocatedMinorUnits: number;
      currency: string;
      periodStart: string;
      periodEnd: string;
    };

    const denial = await authorizeScope(
      dependencies,
      auth.userId,
      body.organizationId,
      body.workspaceId,
    );
    if (denial !== undefined) {
      return reply
        .code(403)
        .send({ error: { code: 'AUTHORIZATION_ERROR', message: denial, requestId: request.id } });
    }
    const authz = await authorizePermission(
      dependencies.permissions,
      { userId: auth.userId, tenantId: body.organizationId, workspaceId: body.workspaceId },
      'budgets.manage',
    );
    if (!authz.ok) {
      return sendForbidden(reply, request.id, 'create a budget');
    }

    const result = await dependencies.createBudget.handle({
      organizationId: body.organizationId as TenantId,
      workspaceId: body.workspaceId as WorkspaceId,
      createdBy: auth.userId,
      actorId: auth.userId,
      correlationId: request.id,
      name: body.name,
      allocatedMinorUnits: body.allocatedMinorUnits,
      currency: body.currency,
      periodStart: body.periodStart,
      periodEnd: body.periodEnd,
    });
    if (!result.ok) {
      const http = toHttpError(result.error, request.id);
      return reply.code(http.statusCode).send(http.body);
    }
    return reply.code(201).send({ budget: toBudgetDto(result.value.budget) });
  });

  app.get('/api/finance/budgets', async (request, reply) => {
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
      return reply
        .code(403)
        .send({ error: { code: 'AUTHORIZATION_ERROR', message: denial, requestId: request.id } });
    }
    const authz = await authorizePermission(
      dependencies.permissions,
      { userId: auth.userId, tenantId: query.organizationId, workspaceId: query.workspaceId },
      'budgets.read',
    );
    if (!authz.ok) {
      return sendForbidden(reply, request.id, 'view budgets');
    }

    const result = await dependencies.listBudgets.handle({
      organizationId: query.organizationId as TenantId,
      workspaceId: query.workspaceId as WorkspaceId,
    });
    if (!result.ok) {
      const http = toHttpError(result.error, request.id);
      return reply.code(http.statusCode).send(http.body);
    }
    return { budgets: result.value };
  });

  app.get('/api/finance/budgets/utilization', async (request, reply) => {
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
      return reply
        .code(403)
        .send({ error: { code: 'AUTHORIZATION_ERROR', message: denial, requestId: request.id } });
    }
    const authz = await authorizePermission(
      dependencies.permissions,
      { userId: auth.userId, tenantId: query.organizationId, workspaceId: query.workspaceId },
      'budgets.read',
    );
    if (!authz.ok) {
      return sendForbidden(reply, request.id, 'view budget utilization');
    }

    const result = await dependencies.listBudgetUtilization.handle({
      organizationId: query.organizationId as TenantId,
      workspaceId: query.workspaceId as WorkspaceId,
    });
    if (!result.ok) {
      const http = toHttpError(result.error, request.id);
      return reply.code(http.statusCode).send(http.body);
    }
    return { utilization: result.value };
  });

  app.get('/api/finance/budgets/:id', async (request, reply) => {
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
      return reply
        .code(403)
        .send({ error: { code: 'AUTHORIZATION_ERROR', message: denial, requestId: request.id } });
    }
    const authz = await authorizePermission(
      dependencies.permissions,
      { userId: auth.userId, tenantId: query.organizationId, workspaceId: query.workspaceId },
      'budgets.read',
    );
    if (!authz.ok) {
      return sendForbidden(reply, request.id, 'view this budget');
    }

    const result = await dependencies.getBudget.handle({
      budgetId: params.id,
      organizationId: query.organizationId as TenantId,
      workspaceId: query.workspaceId as WorkspaceId,
    });
    if (!result.ok) {
      const http = toHttpError(result.error, request.id);
      return reply.code(http.statusCode).send(http.body);
    }
    return { budget: result.value };
  });

  app.patch('/api/finance/budgets/:id', { schema: reviseBudgetSchema }, async (request, reply) => {
    const auth = requireAuth(request);
    const params = request.params as { id: string };
    const body = request.body as {
      organizationId: string;
      workspaceId: string;
      name: string;
      allocatedMinorUnits: number;
      currency: string;
      periodStart: string;
      periodEnd: string;
    };

    const denial = await authorizeScope(
      dependencies,
      auth.userId,
      body.organizationId,
      body.workspaceId,
    );
    if (denial !== undefined) {
      return reply
        .code(403)
        .send({ error: { code: 'AUTHORIZATION_ERROR', message: denial, requestId: request.id } });
    }
    const authz = await authorizePermission(
      dependencies.permissions,
      { userId: auth.userId, tenantId: body.organizationId, workspaceId: body.workspaceId },
      'budgets.manage',
    );
    if (!authz.ok) {
      return sendForbidden(reply, request.id, 'revise a budget');
    }

    const result = await dependencies.reviseBudget.handle({
      budgetId: params.id,
      organizationId: body.organizationId as TenantId,
      workspaceId: body.workspaceId as WorkspaceId,
      actorId: auth.userId,
      correlationId: request.id,
      name: body.name,
      allocatedMinorUnits: body.allocatedMinorUnits,
      currency: body.currency,
      periodStart: body.periodStart,
      periodEnd: body.periodEnd,
    });
    if (!result.ok) {
      const http = toHttpError(result.error, request.id);
      return reply.code(http.statusCode).send(http.body);
    }
    return { budget: toBudgetDto(result.value.budget) };
  });

  app.post(
    '/api/finance/budgets/:id/close',
    { schema: scopeOnlyWithIdSchema },
    async (request, reply) => {
      const auth = requireAuth(request);
      const params = request.params as { id: string };
      const body = request.body as { organizationId: string; workspaceId: string };

      const denial = await authorizeScope(
        dependencies,
        auth.userId,
        body.organizationId,
        body.workspaceId,
      );
      if (denial !== undefined) {
        return reply
          .code(403)
          .send({ error: { code: 'AUTHORIZATION_ERROR', message: denial, requestId: request.id } });
      }
      const authz = await authorizePermission(
        dependencies.permissions,
        { userId: auth.userId, tenantId: body.organizationId, workspaceId: body.workspaceId },
        'budgets.manage',
      );
      if (!authz.ok) {
        return sendForbidden(reply, request.id, 'close a budget');
      }

      const result = await dependencies.closeBudget.handle({
        budgetId: params.id,
        organizationId: body.organizationId as TenantId,
        workspaceId: body.workspaceId as WorkspaceId,
        actorId: auth.userId,
        correlationId: request.id,
      });
      if (!result.ok) {
        const http = toHttpError(result.error, request.id);
        return reply.code(http.statusCode).send(http.body);
      }
      return { budget: toBudgetDto(result.value.budget) };
    },
  );

  app.post(
    '/api/finance/budgets/:id/clear-review',
    { schema: scopeOnlyWithIdSchema },
    async (request, reply) => {
      const auth = requireAuth(request);
      const params = request.params as { id: string };
      const body = request.body as { organizationId: string; workspaceId: string };

      const denial = await authorizeScope(
        dependencies,
        auth.userId,
        body.organizationId,
        body.workspaceId,
      );
      if (denial !== undefined) {
        return reply
          .code(403)
          .send({ error: { code: 'AUTHORIZATION_ERROR', message: denial, requestId: request.id } });
      }
      const authz = await authorizePermission(
        dependencies.permissions,
        { userId: auth.userId, tenantId: body.organizationId, workspaceId: body.workspaceId },
        'budgets.manage',
      );
      if (!authz.ok) {
        return sendForbidden(reply, request.id, 'clear a budget review flag');
      }

      const result = await dependencies.clearBudgetReview.handle({
        budgetId: params.id,
        organizationId: body.organizationId as TenantId,
        workspaceId: body.workspaceId as WorkspaceId,
        actorId: auth.userId,
        correlationId: request.id,
      });
      if (!result.ok) {
        const http = toHttpError(result.error, request.id);
        return reply.code(http.statusCode).send(http.body);
      }
      return { budget: toBudgetDto(result.value.budget) };
    },
  );

  app.post(
    '/api/finance/budgets/flag-over-threshold',
    { schema: scopeOnlyBodySchema },
    async (request, reply) => {
      const auth = requireAuth(request);
      const body = request.body as { organizationId: string; workspaceId: string };

      const denial = await authorizeScope(
        dependencies,
        auth.userId,
        body.organizationId,
        body.workspaceId,
      );
      if (denial !== undefined) {
        return reply
          .code(403)
          .send({ error: { code: 'AUTHORIZATION_ERROR', message: denial, requestId: request.id } });
      }
      const authz = await authorizePermission(
        dependencies.permissions,
        { userId: auth.userId, tenantId: body.organizationId, workspaceId: body.workspaceId },
        'budgets.manage',
      );
      if (!authz.ok) {
        return sendForbidden(reply, request.id, 'flag over-threshold budgets');
      }

      const result = await dependencies.flagOverBudgetItems.handle({
        organizationId: body.organizationId as TenantId,
        workspaceId: body.workspaceId as WorkspaceId,
        actorId: auth.userId,
        correlationId: request.id,
      });
      if (!result.ok) {
        const http = toHttpError(result.error, request.id);
        return reply.code(http.statusCode).send(http.body);
      }
      return { flagged: result.value.flagged.map((budget) => toBudgetDto(budget)) };
    },
  );

  app.post('/api/finance/expenses', { schema: submitExpenseSchema }, async (request, reply) => {
    const auth = requireAuth(request);
    const body = request.body as {
      organizationId: string;
      workspaceId: string;
      budgetId: string;
      description: string;
      amountMinorUnits: number;
      currency: string;
    };

    const denial = await authorizeScope(
      dependencies,
      auth.userId,
      body.organizationId,
      body.workspaceId,
    );
    if (denial !== undefined) {
      return reply
        .code(403)
        .send({ error: { code: 'AUTHORIZATION_ERROR', message: denial, requestId: request.id } });
    }
    const authz = await authorizePermission(
      dependencies.permissions,
      { userId: auth.userId, tenantId: body.organizationId, workspaceId: body.workspaceId },
      'expenses.create',
    );
    if (!authz.ok) {
      return sendForbidden(reply, request.id, 'submit an expense');
    }

    const result = await dependencies.submitExpense.handle({
      organizationId: body.organizationId as TenantId,
      workspaceId: body.workspaceId as WorkspaceId,
      budgetId: body.budgetId,
      submittedBy: auth.userId,
      actorId: auth.userId,
      correlationId: request.id,
      description: body.description,
      amountMinorUnits: body.amountMinorUnits,
      currency: body.currency,
    });
    if (!result.ok) {
      const http = toHttpError(result.error, request.id);
      return reply.code(http.statusCode).send(http.body);
    }
    return reply.code(201).send({ expense: toExpenseDto(result.value.expense) });
  });

  app.get('/api/finance/expenses', async (request, reply) => {
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
      return reply
        .code(403)
        .send({ error: { code: 'AUTHORIZATION_ERROR', message: denial, requestId: request.id } });
    }
    const authz = await authorizePermission(
      dependencies.permissions,
      { userId: auth.userId, tenantId: query.organizationId, workspaceId: query.workspaceId },
      'expenses.read',
    );
    if (!authz.ok) {
      return sendForbidden(reply, request.id, 'view expenses');
    }

    const result = await dependencies.listExpenses.handle({
      organizationId: query.organizationId as TenantId,
      workspaceId: query.workspaceId as WorkspaceId,
    });
    if (!result.ok) {
      const http = toHttpError(result.error, request.id);
      return reply.code(http.statusCode).send(http.body);
    }
    return { expenses: result.value };
  });

  app.get('/api/finance/expenses/:id', async (request, reply) => {
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
      return reply
        .code(403)
        .send({ error: { code: 'AUTHORIZATION_ERROR', message: denial, requestId: request.id } });
    }
    const authz = await authorizePermission(
      dependencies.permissions,
      { userId: auth.userId, tenantId: query.organizationId, workspaceId: query.workspaceId },
      'expenses.read',
    );
    if (!authz.ok) {
      return sendForbidden(reply, request.id, 'view this expense');
    }

    const result = await dependencies.getExpense.handle({
      expenseId: params.id,
      organizationId: query.organizationId as TenantId,
      workspaceId: query.workspaceId as WorkspaceId,
    });
    if (!result.ok) {
      const http = toHttpError(result.error, request.id);
      return reply.code(http.statusCode).send(http.body);
    }
    return { expense: result.value };
  });

  app.post(
    '/api/finance/expenses/:id/decide',
    { schema: decideExpenseSchema },
    async (request, reply) => {
      const auth = requireAuth(request);
      const params = request.params as { id: string };
      const body = request.body as {
        organizationId: string;
        workspaceId: string;
        decision: 'approve' | 'reject';
      };

      const denial = await authorizeScope(
        dependencies,
        auth.userId,
        body.organizationId,
        body.workspaceId,
      );
      if (denial !== undefined) {
        return reply
          .code(403)
          .send({ error: { code: 'AUTHORIZATION_ERROR', message: denial, requestId: request.id } });
      }
      const authz = await authorizePermission(
        dependencies.permissions,
        { userId: auth.userId, tenantId: body.organizationId, workspaceId: body.workspaceId },
        'expenses.decide',
      );
      if (!authz.ok) {
        return sendForbidden(reply, request.id, 'decide this expense');
      }

      const result = await dependencies.decideExpense.handle({
        expenseId: params.id,
        organizationId: body.organizationId as TenantId,
        workspaceId: body.workspaceId as WorkspaceId,
        decision: body.decision,
        decidedBy: auth.userId,
        actorId: auth.userId,
        correlationId: request.id,
      });
      if (!result.ok) {
        const http = toHttpError(result.error, request.id);
        return reply.code(http.statusCode).send(http.body);
      }
      return { expense: toExpenseDto(result.value.expense) };
    },
  );
}
