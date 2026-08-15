/**
 * @nexora/app-api — AI routes.
 *
 * `POST /api/ai/chat` — the Enterprise AI surface: validates the session,
 * validates the workspace scope, runs the request through the
 * {@link EnterpriseAIOrchestrator}, and streams the response as
 * Server-Sent Events (`meta` → `delta*` → `done`). State-changing intents
 * surface an approval gate in `done.approvals`.
 *
 * `POST /api/ai/approvals/:approvalId/decision` — the server-side approval
 * decision surface: records the decision for a request the authenticated
 * user owns. `approve` resumes the gated run through the orchestrator and
 * streams the execution; `reject` records the rejection with no execution.
 * The caller can never approve by modifying the prompt, tool arguments, or
 * request body — the decision is trusted server-side state.
 */

import type { FastifyInstance, FastifyReply, FastifySchema } from 'fastify';
import type { TenantId, WorkspaceId } from '@nexora/contracts/common';
import type { AIBusinessContext, ApprovalEngine } from '@nexora/ai-runtime';
import type { ConversationManager } from '@nexora/ai-runtime/conversation';
import type { OrchestratorResponse } from '@nexora/ai-runtime/orchestrator';
import type { ListOrganizationsHandler } from '@nexora/application-organizations';
import type { ListMyWorkspacesHandler } from '@nexora/application-workspaces';

import { requireAuth } from '../plugins/auth.js';
import {
  chunkText,
  delay,
  formatSse,
  type ChatApprovalPayload,
  type ChatDonePayload,
} from '../ai/chat-stream.js';

/** Request body of POST /api/ai/chat. */
export interface ChatRequestBody {
  /** The user message. */
  message: string;
  /** The workspace scope (validated against the caller's organization). */
  workspaceId?: string;
  /** Continue an existing conversation. */
  conversationId?: string;
}

/** The body schema (Fastify validation). */
const chatSchema: FastifySchema = {
  body: {
    type: 'object',
    required: ['message'],
    additionalProperties: false,
    properties: {
      message: { type: 'string', minLength: 1, maxLength: 4000 },
      workspaceId: { type: 'string', minLength: 1 },
      conversationId: { type: 'string', minLength: 1 },
    },
  },
};

/** The decision body schema. */
const decisionSchema: FastifySchema = {
  params: {
    type: 'object',
    required: ['approvalId'],
    additionalProperties: false,
    properties: { approvalId: { type: 'string', minLength: 1 } },
  },
  body: {
    type: 'object',
    required: ['decision'],
    additionalProperties: false,
    properties: {
      decision: { type: 'string', enum: ['approve', 'reject'] },
      reason: { type: 'string', maxLength: 500 },
    },
  },
};

/** Dependencies of the AI routes. */
export interface AiRoutesDependencies {
  /** The Enterprise AI Orchestrator. */
  orchestrator: {
    run(request: {
      utterance: string;
      userId: string;
      tenantId: string;
      workspaceId?: string;
      conversationId?: string;
      approvalId?: string;
      businessContext?: AIBusinessContext;
    }): Promise<OrchestratorResponse>;
  };
  /** Organization listing (resolves the caller's current tenant). */
  listOrganizations: ListOrganizationsHandler;
  /**
   * Membership-scoped workspace listing. Used both for scope validation and
   * shared with the tool — one authorization path (membership).
   */
  listMyWorkspaces: ListMyWorkspacesHandler;
  /**
   * Builds the TRUSTED business context (domain/role/capability affinity)
   * for a request from membership + the Phase 1 catalog. The model can never
   * supply these values (S24 Phase 3).
   */
  buildBusinessContext: (context: {
    userId: string;
    tenantId: string;
    workspaceId?: string;
  }) => Promise<AIBusinessContext | undefined>;
  /** The server-side approval engine (decisions are trusted state). */
  approvals: ApprovalEngine;
  /** The conversation manager (records approval decisions as turns). */
  conversations: ConversationManager;
}

/** Registers the AI routes. */
export function registerAiRoutes(app: FastifyInstance, dependencies: AiRoutesDependencies): void {
  app.post('/api/ai/chat', { schema: chatSchema }, async (request, reply) => {
    const auth = requireAuth(request);
    const body = request.body as ChatRequestBody;

    // Tenant scope: the session tenant is the platform bootstrap tenant, so
    // the caller's organization is resolved through memberships — mirroring
    // the dashboard selection (first membership = current organization).
    const organizations = await dependencies.listOrganizations.handle({ userId: auth.userId });
    if (!organizations.ok) {
      return reply.code(500).send({
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Could not resolve your organization',
          requestId: request.id,
        },
      });
    }
    const organizationId = organizations.value[0]?.id as TenantId | undefined;
    if (organizationId === undefined) {
      return reply.code(400).send({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Create an organization before using the AI',
          requestId: request.id,
        },
      });
    }

    // Workspace scope validation: the workspace must be one the caller is a
    // MEMBER of (membership is the access rule — same authorization path the
    // tool uses, so scope validation and tool output can never diverge).
    if (body.workspaceId !== undefined) {
      const mine = await dependencies.listMyWorkspaces.handle({
        userId: auth.userId,
        organizationId,
      });
      const canAccess =
        mine.ok && mine.value.some((workspace) => workspace.id === body.workspaceId);
      if (!canAccess) {
        return reply.code(403).send({
          error: {
            code: 'AUTHORIZATION_ERROR',
            message: 'You are not a member of this workspace',
            requestId: request.id,
          },
        });
      }
    }

    // Trusted business context: resolved server-side from membership + the
    // Phase 1 catalog — never from the message, body, or any model claim.
    const businessContext = await dependencies.buildBusinessContext({
      userId: auth.userId,
      tenantId: organizationId,
      workspaceId: body.workspaceId as WorkspaceId | undefined,
    });

    let response: OrchestratorResponse;
    try {
      response = await dependencies.orchestrator.run({
        utterance: body.message,
        userId: auth.userId,
        tenantId: organizationId,
        workspaceId: body.workspaceId as WorkspaceId | undefined,
        conversationId: body.conversationId,
        businessContext,
      });
    } catch (error) {
      request.log.error({ err: error, requestId: request.id }, 'ai chat failed');
      return reply.code(500).send({
        error: {
          code: 'AI_ERROR',
          message: 'The AI could not process the request',
          requestId: request.id,
        },
      });
    }

    await streamChatResponse(reply, response);
    return reply;
  });

  app.post(
    '/api/ai/approvals/:approvalId/decision',
    { schema: decisionSchema },
    async (request, reply) => {
      const auth = requireAuth(request);
      const { approvalId } = request.params as { approvalId: string };
      const body = request.body as { decision: 'approve' | 'reject'; reason?: string };

      const approval = await dependencies.approvals.byId(approvalId);
      if (approval === undefined) {
        return reply.code(404).send({
          error: {
            code: 'NOT_FOUND',
            message: 'Approval request not found',
            requestId: request.id,
          },
        });
      }

      // Ownership: only the requesting user may decide, and only while they
      // still belong to the approval's tenant (membership re-check).
      if (approval.userId !== auth.userId) {
        return reply.code(403).send({
          error: {
            code: 'AUTHORIZATION_ERROR',
            message: 'You are not the requester of this approval',
            requestId: request.id,
          },
        });
      }
      const membership = await dependencies.listOrganizations.handle({ userId: auth.userId });
      const stillMember =
        membership.ok && membership.value.some((org) => org.id === approval.tenantId);
      if (!stillMember) {
        return reply.code(403).send({
          error: {
            code: 'AUTHORIZATION_ERROR',
            message: 'You are not a member of this organization',
            requestId: request.id,
          },
        });
      }

      const decided = await dependencies.approvals.decide(approvalId, {
        decision: body.decision === 'approve' ? 'grant' : 'reject',
        decidedBy: auth.userId,
        reason: body.reason,
      });
      if (!decided.ok) {
        return reply.code(409).send({
          error: {
            code: 'CONFLICT',
            message: 'This approval request has already been decided',
            requestId: request.id,
          },
        });
      }

      if (body.decision === 'reject') {
        // No execution. Record the rejection as a system turn (audit) and
        // return; the frontend surfaces the outcome to the user.
        await appendSystemTurn(dependencies, {
          conversationId: approval.conversationId,
          userId: approval.userId,
          tenantId: approval.tenantId,
          workspaceId: approval.workspaceId,
          content: `Approval rejected by ${auth.userId}`,
        });
        return {
          status: 'rejected',
          conversationId: approval.conversationId,
          approvalId,
        };
      }

      // S24 Phase 6 — cross-process governance: an approval opened by the
      // REMOTE MCP surface carries a `mcp:` conversation id. The decision is
      // recorded above (durable state); execution is resumed by the MCP
      // client's next invocation (the approved action re-resolves the same
      // approval via its resume key, claims it atomically, and executes) —
      // the API process never fabricates an AI plan for an MCP action. AI
      // chat approvals (real conversations) resume through the orchestrator
      // below, exactly as before.
      if (approval.conversationId.startsWith('mcp:')) {
        return {
          status: 'approved',
          conversationId: approval.conversationId,
          approvalId,
        };
      }

      // Approve: resume the gated run through the orchestrator with the
      // server-resolved approval id — the run uses the recorded trusted
      // context, never client-supplied identity. Stream the execution.
      // Rebuild the trusted business context for the SAME trusted context
      // recorded on the approval — never from client input.
      const businessContext = await dependencies.buildBusinessContext({
        userId: approval.userId,
        tenantId: approval.tenantId,
        workspaceId: approval.workspaceId as WorkspaceId | undefined,
      });
      let response: OrchestratorResponse;
      try {
        response = await dependencies.orchestrator.run({
          utterance: approval.intent,
          userId: approval.userId,
          tenantId: approval.tenantId,
          workspaceId: approval.workspaceId as WorkspaceId | undefined,
          conversationId: approval.conversationId,
          approvalId: approval.id,
          businessContext,
        });
      } catch (error) {
        request.log.error({ err: error, requestId: request.id }, 'ai approval resume failed');
        return reply.code(500).send({
          error: {
            code: 'AI_ERROR',
            message: 'The AI could not execute the approved action',
            requestId: request.id,
          },
        });
      }

      await streamChatResponse(reply, response);
      return reply;
    },
  );
}

/** Streams an orchestrator response as SSE (`meta` → `delta*` → `done`). */
async function streamChatResponse(
  reply: FastifyReply,
  response: OrchestratorResponse,
): Promise<void> {
  reply.hijack();
  const raw = reply.raw;
  raw.writeHead(200, {
    'content-type': 'text/event-stream',
    'cache-control': 'no-cache, no-transform',
    connection: 'keep-alive',
    'x-accel-buffering': 'no',
  });
  raw.write(
    formatSse('meta', {
      runId: response.runId,
      conversationId: response.conversationId,
      intent: response.intent,
    }),
  );
  for (const chunk of chunkText(response.response)) {
    raw.write(formatSse('delta', { text: chunk }));
    // Pace the stream so the panel renders progressively.
    await delay(16);
  }
  const done: ChatDonePayload = {
    status: response.status,
    conversationId: response.conversationId,
    response: response.response,
    // Safe plan display: step ids, capabilities, tools, bound input, and
    // workflow display steps — never identity or chain-of-thought.
    plan: (response.plan?.graph.steps ?? []).map((step) => ({
      stepId: step.id,
      capabilityId: step.capabilityId,
      toolId: step.toolId,
      input: step.input,
      workflowSteps: step.workflowSteps,
    })),
    steps: response.steps.map((step) => ({
      stepId: step.stepId,
      capabilityId: step.capabilityId,
      toolId: step.toolId,
      status: step.status,
      output: step.output,
    })),
    approvals: response.approvals.map((approval): ChatApprovalPayload => ({
      // The id is present only when the runtime tracked the request (the
      // approval engine); only then can a decision be posted.
      id: approval.id,
      stepId: approval.stepId,
      capabilityId: approval.capabilityId ?? approval.stepId,
      toolId: approval.toolId,
      status: approval.status,
      sideEffectClass: approval.sideEffectClass,
      input: approval.input,
    })),
  };
  raw.write(formatSse('done', done));
  raw.end();
}

/** Appends a system turn to a conversation the caller owns (audit trail). */
async function appendSystemTurn(
  dependencies: AiRoutesDependencies,
  input: {
    conversationId: string;
    userId: string;
    tenantId: string;
    workspaceId?: string;
    content: string;
  },
): Promise<void> {
  const session = await dependencies.conversations.openSession({
    tenantId: input.tenantId,
    userId: input.userId,
    workspaceId: input.workspaceId,
    conversationId: input.conversationId,
  });
  await dependencies.conversations.addTurn(session, { role: 'system', content: input.content });
}
