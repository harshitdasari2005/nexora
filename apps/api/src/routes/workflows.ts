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
import type { ListMyWorkspacesHandler } from '@nexora/application-workspaces';

import { requireAuth } from '../plugins/auth.js';
import {
  authorizePermission,
  type PermissionResolverDependencies,
} from '../business-context/permissions.js';
import { sendForbidden } from './permission-response.js';
import type { SideEffectClass } from '@nexora/contracts/ai';
import {
  authorizeWorkflowInitiator,
  type InitiatorCapabilityResolver,
} from '../ai/workflow-initiator.js';
import type { ApprovalEngine } from '@nexora/ai-runtime';
import type { LineageRepository } from '@nexora/module-lineage';
import {
  approvalOnlyView,
  buildWorkflowRecordView,
  isWorkflowApproval,
  readRunLineage,
  type CompositeApprovalViewDto,
  type WorkflowInstanceViewDto,
} from './workflow-read-model.js';
import {
  enforceRestPolicy,
  governingApprovalPolicy,
  sendRestPolicyRefusal,
  type RestPolicyDependencies,
} from '../policy/rest-policy.js';

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
  /** Workspace memberships: scope of who may cancel another user's instance (Prompt 9). */
  listMyWorkspaces: ListMyWorkspacesHandler;
  /** RBAC: the SAME trusted role resolver + catalog every surface uses. */
  permissions: PermissionResolverDependencies;
  /** The capabilities/tools a registered definition's steps invoke (`undefined` = unknown key). */
  requiredCapabilities: (
    definitionKey: string,
  ) => readonly { capabilityId: string; toolId: string }[] | undefined;
  /** Resolves the initiator's RBAC-granted executable capabilities (trusted). */
  initiatorCapabilities: InitiatorCapabilityResolver;
  /** The side-effect class of a tool (from the canonical manifest), when registered. */
  sideEffectOf: (toolId: string) => SideEffectClass | undefined;
  /** The central policy stack a REST mutation consults (lazy: composed after routes). */
  restPolicy: () => RestPolicyDependencies;
  /**
   * Read model inputs (all optional so a minimal composition still serves the
   * sanitized read model): the append-only lineage (inner-step verification),
   * the approval engine (composite unit approvals, which exist BEFORE any
   * instance) and the lazy expiry sweep.
   */
  lineage?: LineageRepository;
  approvals?: ApprovalEngine;
  sweepExpiredApprovals?: () => Promise<unknown>;
}

/** How many of the newest approvals the composite listing scans. */
const COMPOSITE_APPROVAL_SCAN_LIMIT = 200;
/** How many instances get a lineage-derived verification summary per listing. */
const LIST_VERIFICATION_LIMIT = 50;

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

    // Initiator authority: `workflows.execute` alone grants none of the
    // capabilities the inner steps use. The initiator must hold EVERY one
    // (trusted membership -> role -> RBAC), and that ceiling is bound to the
    // instance, where it bounds every inner step and compensation.
    let ceiling: readonly string[] = [];
    const required = dependencies.requiredCapabilities(body.definitionKey);
    if (required !== undefined) {
      const authority = await authorizeWorkflowInitiator({
        resolver: dependencies.initiatorCapabilities,
        scope: { userId: auth.userId, tenantId: body.organizationId },
        required: required.map((step) => step.capabilityId),
      });
      if (!authority.ok) {
        return sendForbidden(reply, request.id, 'run every step of this workflow');
      }
      ceiling = authority.ceiling;

      // Central policy (origin `rest`) over the inner steps, BEFORE anything
      // starts: a policy DENY is final for a human too; an approval that
      // policy requires beyond the baseline side-effect gate is NOT
      // silently satisfied by a REST start — it must go through the governed
      // AI/approval path (409). The baseline gate alone (BR-13) is satisfied
      // by this direct, RBAC-authorized human start.
      for (const step of required) {
        const policy = await enforceRestPolicy(dependencies.restPolicy(), {
          capabilityId: step.capabilityId,
          organizationId: body.organizationId,
          userId: auth.userId,
          requestId: request.id,
          input: {},
          sideEffectClass: dependencies.sideEffectOf(step.toolId) ?? 'consequential',
        });
        if (!policy.ok) {
          return sendRestPolicyRefusal(reply, request.id, policy);
        }
        if (policy.decision.outcome === 'REQUIRE_APPROVAL' && !policy.baselineApprovalOnly) {
          return reply.code(409).send({
            error: {
              code: 'APPROVAL_REQUIRED',
              message:
                'Policy requires approval for a step of this workflow; start it through the governed AI/approval path',
              requestId: request.id,
              policy: governingApprovalPolicy(policy.decision) ?? policy.record,
            },
          });
        }
      }
    }

    const result = await dependencies.startWorkflow.handle({
      definitionKey: body.definitionKey,
      context: {
        userId: auth.userId,
        tenantId: body.organizationId as TenantId,
        correlationId: request.id,
        // Human operator path (no agent principal) — Prompt 4 attribution.
        origin: 'rest',
        // The initiator's RBAC ceiling — bounds every inner step + compensation.
        allowedCapabilityIds: ceiling,
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
    return reply.code(201).send({
      workflow: buildWorkflowRecordView({
        record: result.value,
        lineage: await readRunLineage(
          dependencies.lineage,
          body.organizationId,
          result.value.instance.correlationId,
        ),
        sideEffectOf: dependencies.sideEffectOf,
      }),
    });
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

    // The truthful composite state of each instance (sanitized: no inputs or
    // outputs). Verification is lineage-derived, so it needs the journal.
    const instances: WorkflowInstanceViewDto[] = [];
    let index = 0;
    for (const instance of result.value) {
      const detail =
        index < LIST_VERIFICATION_LIMIT || instance.status === 'failed'
          ? await dependencies.getWorkflow.handle({
              workflowId: instance.id,
              tenantId: organizationId as TenantId,
            })
          : undefined;
      index += 1;
      if (detail === undefined || !detail.ok) {
        // Beyond the scan cap: derive from the instance alone (a succeeded
        // instance without a checked journal can never read "verified").
        instances.push(
          buildWorkflowRecordView({
            record: { instance, steps: [] },
            lineage: [],
            sideEffectOf: dependencies.sideEffectOf,
          }).instance,
        );
        continue;
      }
      const lineage = await readRunLineage(
        dependencies.lineage,
        organizationId,
        detail.value.instance.correlationId,
      );
      instances.push(
        buildWorkflowRecordView({
          record: detail.value,
          lineage,
          sideEffectOf: dependencies.sideEffectOf,
        }).instance,
      );
    }

    // Composite unit approvals that have NO instance (yet, or ever): the
    // pending / rejected / expired / refused ones. Scoped to the caller's own
    // approvals and to workspaces they belong to.
    const composites: CompositeApprovalViewDto[] = [];
    if (dependencies.approvals !== undefined) {
      await dependencies.sweepExpiredApprovals?.();
      const mine = await dependencies.listMyWorkspaces.handle({
        userId: auth.userId,
        organizationId: organizationId as TenantId,
      });
      const workspaceIds = new Set(mine.ok ? mine.value.map((workspace) => workspace.id) : []);
      const linked = new Set(
        result.value.map((instance) => instance.approvalId).filter((id) => id !== undefined),
      );
      const records = await dependencies.approvals.listByTenant(organizationId, {
        limit: COMPOSITE_APPROVAL_SCAN_LIMIT,
      });
      for (const approval of records) {
        if (!isWorkflowApproval(approval) || linked.has(approval.id)) continue;
        const visible =
          approval.userId === auth.userId ||
          (approval.workspaceId !== undefined && workspaceIds.has(approval.workspaceId));
        if (!visible) continue;
        composites.push({
          ...approvalOnlyView(approval),
          definitionKey: approval.capabilityId.slice('workflow.'.length),
        });
      }
    }
    return { workflows: instances, composites };
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
    const lineage = await readRunLineage(
      dependencies.lineage,
      organizationId,
      result.value.instance.correlationId,
    );
    const approvalId = result.value.instance.approvalId;
    const approval =
      approvalId === undefined ? undefined : await dependencies.approvals?.byId(approvalId);
    return {
      workflow: buildWorkflowRecordView({
        record: result.value,
        lineage,
        sideEffectOf: dependencies.sideEffectOf,
        ...(approval === undefined || approval.tenantId !== organizationId ? {} : { approval }),
      }),
    };
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

    // Ownership scope (Prompt 9): `workflows.execute` is an organization-level
    // capability, so it alone must not let one member cancel ANOTHER user's
    // instance in a workspace they are not part of. The caller must be the
    // initiator, or a member of the instance's workspace. Anything else is
    // indistinguishable from a missing instance (404 — no existence leak).
    const existing = await dependencies.getWorkflow.handle({
      workflowId: params.workflowId,
      tenantId: organizationId as TenantId,
    });
    if (existing.ok && existing.value.instance.userId !== auth.userId) {
      const workspaceId = existing.value.instance.workspaceId;
      const mine =
        workspaceId === undefined
          ? undefined
          : await dependencies.listMyWorkspaces.handle({
              userId: auth.userId,
              organizationId: organizationId as TenantId,
            });
      const sharesWorkspace =
        mine !== undefined &&
        mine.ok &&
        mine.value.some((workspace) => workspace.id === workspaceId);
      if (!sharesWorkspace) {
        return reply.code(404).send({
          error: { code: 'NOT_FOUND', message: 'Workflow not found', requestId: request.id },
        });
      }
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
