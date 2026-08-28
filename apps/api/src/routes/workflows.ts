/**
 * @nexora/app-api — workflow routes.
 *
 * The workflow execution surface (workflow vertical slice): start a workflow
 * instance from a registered definition, list the tenant's workflows, read
 * an execution record (instance + step journal), and cancel a running
 * workflow. The authenticated user must be a member of the target
 * organization (membership gating — the same authorization rule the AI tool
 * uses, so the REST and AI surfaces share ONE execution path and ONE
 * authorization model).
 *
 * Approval decisions continue to use the existing approval endpoint
 * (`POST /api/ai/approvals/:approvalId/decision`) — no duplicate approval
 * API is introduced. Workflows started through this surface run their steps
 * through the same governed tool pipeline as AI-initiated workflows.
 *
 * Governance model (documented in `platform/workflow/README.md`): approval
 * is an AI-orchestration-path control. AI-initiated workflows are gated as
 * a unit (consequential tool → approval required) BEFORE any step runs.
 * REST starts are the authenticated operator path — membership of the
 * trusted organization is the authorization rule — consistent with the
 * existing consequential REST surfaces (`POST /api/projects`, `POST
 * /api/workspaces`). The workflow-unit gate is the AI path; both paths
 * execute steps through the exact same governed tool pipeline.
 *
 * A SECOND boundary (P0 security hardening) sits on top of membership: the
 * caller's effective RBAC capability — `workflows.read` to list or read a
 * workflow, `workflows.execute` to start or cancel one — via the SAME
 * `authorizePermission` every other surface uses, never a second permission
 * model.
 */

import type { FastifyInstance, FastifySchema } from 'fastify';
import type { TenantId } from '@nexora/contracts/common';
import type {
  CancelWorkflowHandler,
  GetWorkflowHandler,
  ListWorkflowsHandler,
  StartWorkflowHandler,
} from '@nexora/module-workflow';
import type { ListOrganizationsHandler } from '@nexora/application-organizations';

import { requireAuth } from '../plugins/auth.js';
import {
  authorizePermission,
  type PermissionResolverDependencies,
} from '../business-context/permissions.js';
import { sendForbidden } from './permission-response.js';

/** Request body schema for POST /api/workflows. */
const createWorkflowSchema: FastifySchema = {
  body: {
    type: 'object',
    required: ['organizationId', 'definitionKey', 'input'],
    additionalProperties: false,
    properties: {
      organizationId: { type: 'string', minLength: 1 },
      definitionKey: { type: 'string', minLength: 1, maxLength: 128 },
      input: { type: 'object', additionalProperties: true },
    },
  },
};

/** Dependencies of the workflow routes. */
export interface WorkflowRoutesDependencies {
  startWorkflow: StartWorkflowHandler;
  cancelWorkflow: CancelWorkflowHandler;
  getWorkflow: GetWorkflowHandler;
  listWorkflows: ListWorkflowsHandler;
  listOrganizations: ListOrganizationsHandler;
  /** RBAC: the SAME trusted role resolver + catalog every surface uses. */
  permissions: PermissionResolverDependencies;
}

/** Registers the workflow routes. */
export function registerWorkflowRoutes(
  app: FastifyInstance,
  dependencies: WorkflowRoutesDependencies,
): void {
  app.post('/api/workflows', { schema: createWorkflowSchema }, async (request, reply) => {
    const auth = requireAuth(request);
    const body = request.body as {
      organizationId: string;
      definitionKey: string;
      input: Record<string, unknown>;
    };

    const membership = await dependencies.listOrganizations.handle({ userId: auth.userId });
    const canAccess =
      membership.ok && membership.value.some((org) => org.id === body.organizationId);
    if (!canAccess) {
      return reply.code(403).send({
        error: {
          code: 'AUTHORIZATION_ERROR',
          message: 'You are not a member of this organization',
          requestId: request.id,
        },
      });
    }
    const authz = await authorizePermission(
      dependencies.permissions,
      { userId: auth.userId, tenantId: body.organizationId },
      'workflows.execute',
    );
    if (!authz.ok) {
      return sendForbidden(reply, request.id, 'start a workflow');
    }

    const result = await dependencies.startWorkflow.handle({
      definitionKey: body.definitionKey,
      context: {
        userId: auth.userId,
        tenantId: body.organizationId as TenantId,
        correlationId: request.id,
      },
      input: body.input,
    });
    if (!result.ok) {
      return reply.code(400).send({
        error: {
          code: 'VALIDATION_ERROR',
          message: result.error.message,
          requestId: request.id,
        },
      });
    }
    return reply.code(201).send({ workflow: result.value });
  });

  app.get('/api/workflows', async (request, reply) => {
    const auth = requireAuth(request);
    const query = request.query as { organizationId?: string };
    const organizationId = query.organizationId;
    if (organizationId === undefined) {
      return reply.code(400).send({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Missing required query parameter: organizationId',
          requestId: request.id,
        },
      });
    }

    const membership = await dependencies.listOrganizations.handle({ userId: auth.userId });
    const canAccess = membership.ok && membership.value.some((org) => org.id === organizationId);
    if (!canAccess) {
      return reply.code(403).send({
        error: {
          code: 'AUTHORIZATION_ERROR',
          message: 'You are not a member of this organization',
          requestId: request.id,
        },
      });
    }
    const authz = await authorizePermission(
      dependencies.permissions,
      { userId: auth.userId, tenantId: organizationId },
      'workflows.read',
    );
    if (!authz.ok) {
      return sendForbidden(reply, request.id, 'view workflows');
    }

    const result = await dependencies.listWorkflows.handle({
      tenantId: organizationId as TenantId,
    });
    if (!result.ok) {
      return reply.code(500).send({
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Could not list workflows',
          requestId: request.id,
        },
      });
    }
    return { workflows: result.value };
  });

  app.get('/api/workflows/:workflowId', async (request, reply) => {
    const auth = requireAuth(request);
    const params = request.params as { workflowId: string };
    const query = request.query as { organizationId?: string };
    const organizationId = query.organizationId;
    if (organizationId === undefined) {
      return reply.code(400).send({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Missing required query parameter: organizationId',
          requestId: request.id,
        },
      });
    }

    const membership = await dependencies.listOrganizations.handle({ userId: auth.userId });
    const canAccess = membership.ok && membership.value.some((org) => org.id === organizationId);
    if (!canAccess) {
      return reply.code(403).send({
        error: {
          code: 'AUTHORIZATION_ERROR',
          message: 'You are not a member of this organization',
          requestId: request.id,
        },
      });
    }
    const authz = await authorizePermission(
      dependencies.permissions,
      { userId: auth.userId, tenantId: organizationId },
      'workflows.read',
    );
    if (!authz.ok) {
      return sendForbidden(reply, request.id, 'view this workflow');
    }

    const result = await dependencies.getWorkflow.handle({
      workflowId: params.workflowId,
      tenantId: organizationId as TenantId,
    });
    if (!result.ok) {
      return reply.code(404).send({
        error: {
          code: 'NOT_FOUND',
          message: 'Workflow not found',
          requestId: request.id,
        },
      });
    }
    return { workflow: result.value };
  });

  app.post('/api/workflows/:workflowId/cancel', async (request, reply) => {
    const auth = requireAuth(request);
    const params = request.params as { workflowId: string };
    const query = request.query as { organizationId?: string };
    const organizationId = query.organizationId;
    if (organizationId === undefined) {
      return reply.code(400).send({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Missing required query parameter: organizationId',
          requestId: request.id,
        },
      });
    }

    const membership = await dependencies.listOrganizations.handle({ userId: auth.userId });
    const canAccess = membership.ok && membership.value.some((org) => org.id === organizationId);
    if (!canAccess) {
      return reply.code(403).send({
        error: {
          code: 'AUTHORIZATION_ERROR',
          message: 'You are not a member of this organization',
          requestId: request.id,
        },
      });
    }
    const authz = await authorizePermission(
      dependencies.permissions,
      { userId: auth.userId, tenantId: organizationId },
      'workflows.execute',
    );
    if (!authz.ok) {
      return sendForbidden(reply, request.id, 'cancel a workflow');
    }

    const result = await dependencies.cancelWorkflow.handle({
      workflowId: params.workflowId,
      actorId: auth.userId,
      tenantId: organizationId as TenantId,
    });
    if (!result.ok) {
      return reply.code(404).send({
        error: {
          code: 'NOT_FOUND',
          message: result.error.message,
          requestId: request.id,
        },
      });
    }
    return { workflow: result.value };
  });
}
