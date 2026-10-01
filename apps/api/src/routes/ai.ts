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
import {
  isRecoveryRequired,
  type AIBusinessContext,
  type ApprovalEngine,
  type ApprovalRequestRecord,
} from '@nexora/ai-runtime';
import type { AgentPrincipal, AgentPrincipalContext } from '@nexora/contracts/agent';
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
import type { PermissionResolverDependencies } from '../business-context/permissions.js';
import { authorizeApprovalDecision } from '../ai/approval-authorization.js';
import {
  approvalRefusalReasonCode,
  toApprovalGovernanceDto,
  type ApprovalLifecycle,
} from '../ai/approval-governance.js';
import type { SecurityDecisionSink } from '@nexora/ai-runtime/execution';

/** Request body of POST /api/ai/chat. */
export interface ChatRequestBody {
  /** The user message. */
  message: string;
  /**
   * The organization scope. Optional — when omitted the caller's first
   * membership is used (dashboard convention). When present it MUST be an
   * organization the caller belongs to, else 403.
   */
  organizationId?: string;
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
      organizationId: { type: 'string', minLength: 1 },
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

/** The pending-approvals query schema. */
const pendingSchema: FastifySchema = {
  querystring: {
    type: 'object',
    required: ['organizationId', 'workspaceId'],
    additionalProperties: false,
    properties: {
      organizationId: { type: 'string', minLength: 1 },
      workspaceId: { type: 'string', minLength: 1 },
    },
  },
};

const approvalReadSchema: FastifySchema = {
  params: {
    type: 'object',
    required: ['approvalId'],
    additionalProperties: false,
    properties: { approvalId: { type: 'string', minLength: 1 } },
  },
  querystring: pendingSchema.querystring as object,
};

/** How many of the newest approvals a pending listing considers. */
const PENDING_SCAN_LIMIT = 200;

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
      allowedCapabilityIds?: readonly string[];
      agent?: AgentPrincipalContext;
      requestId?: string;
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
  /**
   * Approval lifecycle audit events + the expiry sweeper (Prompt 8).
   * `approval.granted|rejected` are published on a successful decision;
   * `approval.expired` ONLY by the call whose engine result reported
   * `transitioned` (never twice).
   */
  lifecycle: ApprovalLifecycle;
  /** Resolves a user's display name (pending list; optional, best-effort). */
  resolveUserName?: (userId: string) => Promise<string | undefined>;
  /** The conversation manager (records approval decisions as turns). */
  conversations: ConversationManager;
  /** RBAC: the SAME trusted role resolver + catalog every surface uses. */
  permissions: PermissionResolverDependencies;
  /** Records refused approval decisions in the audit trail. */
  securitySink?: SecurityDecisionSink;
  /**
   * Prompt 4: resolves the persisted agent principal an agent-opened
   * approval must resume AS (tenant-scoped), and journals the resumed run.
   */
  agentPrincipals?: {
    findById(organizationId: string, agentId: string): Promise<AgentPrincipal | undefined>;
  };
  /**
   * Prompt 9: the agent principal's CURRENT effective capabilities (definition
   * ceiling ∩ active, unexpired delegations whose grantor still holds them),
   * tenant + workspace scoped. An agent-opened approval resumes under the
   * requester's executable capabilities INTERSECTED with this set — never the
   * requester's full ceiling. Absent/`undefined` fails closed (empty ceiling).
   */
  resolveAgentEffectiveCapabilities?: (input: {
    userId: string;
    tenantId: string;
    workspaceId?: string;
    agentId: string;
  }) => Promise<readonly string[] | undefined>;
  onAgentApprovalExecuted?: (input: {
    approval: ApprovalRequestRecord;
    principal: AgentPrincipal | undefined;
    response: OrchestratorResponse;
  }) => Promise<void>;
}

/** Registers the AI routes. */
export function registerAiRoutes(app: FastifyInstance, dependencies: AiRoutesDependencies): void {
  app.post('/api/ai/chat', { schema: chatSchema }, async (request, reply) => {
    const auth = requireAuth(request);
    const body = request.body as ChatRequestBody;

    // Tenant scope: the session tenant is the platform bootstrap tenant, so
    // the caller's organization is resolved through memberships. When the
    // client passes `organizationId` it must be one the caller belongs to
    // (same rule as /dashboard, /notifications, /finance); otherwise the
    // first membership is the default (dashboard convention).
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
    let organizationId: TenantId | undefined;
    if (body.organizationId !== undefined) {
      const belongs = organizations.value.some((org) => org.id === body.organizationId);
      if (!belongs) {
        return reply.code(403).send({
          error: {
            code: 'AUTHORIZATION_ERROR',
            message: 'You are not a member of this organization',
            requestId: request.id,
          },
        });
      }
      organizationId = body.organizationId as TenantId;
    } else {
      organizationId = organizations.value[0]?.id as TenantId | undefined;
    }
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
        requestId: request.id,
        utterance: body.message,
        userId: auth.userId,
        tenantId: organizationId,
        workspaceId: body.workspaceId as WorkspaceId | undefined,
        conversationId: body.conversationId,
        businessContext,
        // S34: the RBAC ceiling for this run — the SAME executable
        // capability ids the business context derives from the caller's
        // trusted role. An AI action can never reach beyond what the
        // caller's own role permits, chat included (previously only
        // agent-triggered runs carried this ceiling; a plain chat message
        // ran with no ceiling at all). Empty-ceiling hardening: a role with
        // no executable capability (or no resolvable role at all) gets an
        // EMPTY ceiling = no authority — never "unrestricted". Only a trusted
        // internal caller may pass `undefined`; a human chat run never does.
        allowedCapabilityIds: businessContext?.capabilityIds ?? [],
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

  // The pending approvals of one workspace, with the caller's server-computed
  // `canDecide` (the SAME `authorizeApprovalDecision` the decision route runs —
  // never a UI claim).
  app.get('/api/approvals/pending', { schema: pendingSchema }, async (request, reply) => {
    const auth = requireAuth(request);
    const query = request.query as { organizationId: string; workspaceId: string };
    const organizations = await dependencies.listOrganizations.handle({ userId: auth.userId });
    if (!organizations.ok || !organizations.value.some((org) => org.id === query.organizationId)) {
      return reply.code(403).send({
        error: {
          code: 'AUTHORIZATION_ERROR',
          message: 'You are not a member of this organization',
          requestId: request.id,
        },
      });
    }
    const mine = await dependencies.listMyWorkspaces.handle({
      userId: auth.userId,
      organizationId: query.organizationId as TenantId,
    });
    if (!mine.ok || !mine.value.some((workspace) => workspace.id === query.workspaceId)) {
      return reply.code(403).send({
        error: {
          code: 'AUTHORIZATION_ERROR',
          message: 'You are not a member of this workspace',
          requestId: request.id,
        },
      });
    }
    // Lazy sweeps: expiry, then recovery of abandoned `executing` approvals
    // (failed RECOVERY_REQUIRED — never re-executed; a human verifies state).
    await dependencies.lifecycle.sweepApprovals();
    const records = await dependencies.approvals.listByTenant(query.organizationId, {
      workspaceId: query.workspaceId,
      limit: PENDING_SCAN_LIMIT,
    });
    const pending = records.filter((record) => record.status === 'awaiting_approval');
    const recoveryRequired = records
      .filter(isRecoveryRequired)
      .map((record) => toApprovalGovernanceDto(record, { canDecide: false }));
    const names = new Map<string, string | undefined>();
    const approvals = [];
    for (const record of pending) {
      const verdict = await authorizeApprovalDecision(dependencies, {
        approval: record,
        deciderId: auth.userId,
      });
      if (!names.has(record.userId)) {
        names.set(record.userId, await dependencies.resolveUserName?.(record.userId));
      }
      approvals.push(
        toApprovalGovernanceDto(
          record,
          verdict.ok ? { canDecide: true } : { canDecide: false, denyReason: verdict.refusal },
          names.get(record.userId),
        ),
      );
    }
    return { approvals, recoveryRequired };
  });

  // One approval's persisted state (any lifecycle status), for the same
  // members who may list the workspace's approvals. Read-only: it reports what
  // the approval engine recorded (status, decider, timestamps) — the Guided Demo
  // and the Approvals page derive "approved / rejected / expired" from THIS,
  // never from a client-side assumption. A foreign or unknown id is a 404.
  app.get('/api/approvals/:approvalId', { schema: approvalReadSchema }, async (request, reply) => {
    const auth = requireAuth(request);
    const { approvalId } = request.params as { approvalId: string };
    const query = request.query as { organizationId: string; workspaceId: string };
    const notFound = () =>
      reply.code(404).send({
        error: { code: 'NOT_FOUND', message: 'Approval request not found', requestId: request.id },
      });
    const organizations = await dependencies.listOrganizations.handle({ userId: auth.userId });
    if (!organizations.ok || !organizations.value.some((org) => org.id === query.organizationId)) {
      return reply.code(403).send({
        error: {
          code: 'AUTHORIZATION_ERROR',
          message: 'You are not a member of this organization',
          requestId: request.id,
        },
      });
    }
    const mine = await dependencies.listMyWorkspaces.handle({
      userId: auth.userId,
      organizationId: query.organizationId as TenantId,
    });
    if (!mine.ok || !mine.value.some((workspace) => workspace.id === query.workspaceId)) {
      return reply.code(403).send({
        error: {
          code: 'AUTHORIZATION_ERROR',
          message: 'You are not a member of this workspace',
          requestId: request.id,
        },
      });
    }
    await dependencies.lifecycle.sweepApprovals();
    const record = await dependencies.approvals.byId(approvalId);
    if (
      record === undefined ||
      record.tenantId !== query.organizationId ||
      record.workspaceId !== query.workspaceId
    ) {
      return notFound();
    }
    const verdict = await authorizeApprovalDecision(dependencies, {
      approval: record,
      deciderId: auth.userId,
    });
    const [requesterName, decidedByName] = await Promise.all([
      dependencies.resolveUserName?.(record.userId),
      record.decidedBy === undefined ? undefined : dependencies.resolveUserName?.(record.decidedBy),
    ]);
    return {
      approval: {
        ...toApprovalGovernanceDto(
          record,
          verdict.ok ? { canDecide: true } : { canDecide: false, denyReason: verdict.refusal },
          requesterName,
        ),
        runId: record.runId,
        intent: record.intent,
        ...(record.decision === undefined ? {} : { decision: record.decision }),
        ...(record.decidedBy === undefined ? {} : { decidedById: record.decidedBy }),
        ...(decidedByName === undefined ? {} : { decidedByName }),
        ...(record.decidedAt === undefined ? {} : { decidedAt: record.decidedAt }),
        ...(record.executedAt === undefined ? {} : { executedAt: record.executedAt }),
        ...(record.error === undefined ? {} : { error: record.error }),
      },
    };
  });

  app.post(
    '/api/ai/approvals/:approvalId/decision',
    { schema: decisionSchema },
    async (request, reply) => {
      const auth = requireAuth(request);
      const { approvalId } = request.params as { approvalId: string };
      const body = request.body as { decision: 'approve' | 'reject'; reason?: string };

      // Lazy, deterministic expiry sweep (publishes `approval.expired` once per
      // transition) so a stale approval reads as expired below.
      await dependencies.lifecycle.sweepApprovals();
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

      // One deterministic rule set for every decision channel (REST + inbound
      // email + the pending list's `canDecide`): membership, `approvals.decide`,
      // the policy-required approver role, separation of duties (or the legacy
      // requester rule), and the gated capability still within the REQUESTER's
      // role — see `ai/approval-authorization.ts`. Nothing in the request body
      // (`role`, `approver`, ...) is ever read: the schema rejects extra fields
      // and the decider is the authenticated session user.
      const authorization = await authorizeApprovalDecision(dependencies, {
        approval,
        deciderId: auth.userId,
      });
      if (!authorization.ok) {
        if (authorization.refusal === 'APPROVAL_EXPIRED') {
          return reply.code(410).send({
            error: {
              code: 'APPROVAL_EXPIRED',
              message: 'This approval request has expired',
              requestId: request.id,
            },
          });
        }
        await dependencies.securitySink?.({
          actorId: auth.userId,
          origin: 'approval',
          invocationId: approval.runId ?? approvalId,
          organizationId: approval.tenantId,
          ...(approval.workspaceId === undefined ? {} : { workspaceId: approval.workspaceId }),
          toolId: approval.toolId,
          capabilityId: approval.capabilityId,
          action: 'approval.decide',
          policyDecision: 'deny',
          reasonCode: approvalRefusalReasonCode(authorization.refusal),
          reason: `decision refused: ${authorization.refusal}`,
          outcome: 'blocked',
          occurredAt: new Date().toISOString(),
        });
        if (authorization.refusal === 'NOT_A_MEMBER') {
          // No standing in the approval's organization/workspace: the caller is
          // told EXACTLY what they would be told for a missing approval, so the
          // response cannot be used to learn whether an approval id exists. The
          // refusal above is still recorded in the approval's own tenant audit
          // trail (documented: TRUST_MODEL §approval authority, NXS-119).
          return reply.code(404).send({
            error: {
              code: 'NOT_FOUND',
              message: 'Approval request not found',
              requestId: request.id,
            },
          });
        }
        return reply.code(403).send({
          error: {
            code: 'AUTHORIZATION_ERROR',
            message: authorization.message,
            requestId: request.id,
          },
        });
      }
      const { businessContext, executableCapabilityIds } = authorization;

      const decided = await dependencies.approvals.decide(approvalId, {
        decision: body.decision === 'approve' ? 'grant' : 'reject',
        decidedBy: auth.userId,
        reason: body.reason,
      });
      if (!decided.ok) {
        if (decided.reason === 'expired') {
          // Idempotent: repeated calls keep answering 410; the audit event is
          // published only by the call that persisted the transition.
          if (decided.transitioned && decided.request !== undefined) {
            await dependencies.lifecycle.publish({ kind: 'expired', approval: decided.request });
          }
          return reply.code(410).send({
            error: {
              code: 'APPROVAL_EXPIRED',
              message: 'This approval request has expired',
              requestId: request.id,
            },
          });
        }
        return reply.code(409).send({
          error: {
            code: 'CONFLICT',
            message: 'This approval request has already been decided',
            requestId: request.id,
          },
        });
      }
      await dependencies.lifecycle.publish({
        kind: body.decision === 'approve' ? 'granted' : 'rejected',
        approval: decided.request,
        decidedBy: auth.userId,
      });

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
      // the API process never fabricates an AI plan for an MCP action.
      // Phase 10 — the SAME reasoning applies to a REMEDIATION-opened
      // approval (`remediation:` conversation id): the remediation engine
      // owns step execution through its own capability-bound execution path
      // (never the chat orchestrator's deterministic token match, which has
      // no `allowedCapabilityIds` restriction and can resolve a DIFFERENT
      // capability than the approved step). The decision is recorded above;
      // execution is resumed by the caller's next `advance()` call, which
      // re-checks this SAME decision and claims + executes exactly once. AI
      // chat approvals (real conversations) resume through the orchestrator
      // below, exactly as before.
      if (
        approval.conversationId.startsWith('mcp:') ||
        approval.conversationId.startsWith('remediation:')
      ) {
        return {
          status: 'approved',
          conversationId: approval.conversationId,
          approvalId,
        };
      }

      // Approve: resume the gated run through the orchestrator with the
      // server-resolved approval id — the run uses the recorded trusted
      // context, never client-supplied identity. Stream the execution.
      // `businessContext` was already rebuilt above (for the capability
      // pre-check) from this SAME trusted context — reused here, not
      // refetched.
      // Prompt 4: an approval opened by an AGENT run resumes AS that agent —
      // the principal comes from the approval record (server state), is
      // re-loaded from persistence, and every step is re-authorized against
      // its delegations at execution time (a delegation revoked/expired or an
      // agent suspended after the approval fails closed there). It never
      // resumes under the human's broader authority.
      let principal: AgentPrincipal | undefined;
      let agent: AgentPrincipalContext | undefined;
      // The ceiling the resumed run executes under: the requester's executable
      // capabilities, and for an AGENT approval additionally bounded by what the
      // agent principal can exercise right now (never the requester's full set).
      let resumeCeiling: readonly string[] = executableCapabilityIds;
      if (approval.agentId !== undefined) {
        const agentEffective = await dependencies.resolveAgentEffectiveCapabilities?.({
          userId: approval.userId,
          tenantId: approval.tenantId,
          ...(approval.workspaceId === undefined ? {} : { workspaceId: approval.workspaceId }),
          agentId: approval.agentId,
        });
        // The gated capability itself always stays in the ceiling: if the agent
        // LOST it (delegation revoked/expired, agent suspended) the executor's
        // execution-time delegation check must still be the one that refuses —
        // audited with its specific reason (DELEGATION_REVOKED, ...). Only the
        // OTHER capabilities (a composite's inner steps) are bounded by what the
        // agent can exercise right now.
        const agentSet = new Set(agentEffective ?? []);
        const narrowed = executableCapabilityIds.filter(
          (id) => agentSet.has(id) || id === approval.capabilityId,
        );
        // An EMPTY ceiling means "no restriction" downstream, so fail closed with a
        // sentinel no capability can match instead of passing `[]`.
        resumeCeiling = narrowed.length > 0 ? narrowed : [NO_EFFECTIVE_CAPABILITY];
        principal = await dependencies.agentPrincipals?.findById(
          approval.tenantId,
          approval.agentId,
        );
        agent = {
          agentId: approval.agentId,
          definitionId: principal?.definitionId ?? '',
          name: principal?.name ?? '',
        };
      }
      let response: OrchestratorResponse;
      try {
        response = await dependencies.orchestrator.run({
          requestId: request.id,
          utterance: approval.intent,
          userId: approval.userId,
          tenantId: approval.tenantId,
          workspaceId: approval.workspaceId as WorkspaceId | undefined,
          conversationId: approval.conversationId,
          approvalId: approval.id,
          businessContext,
          allowedCapabilityIds: resumeCeiling,
          ...(agent === undefined ? {} : { agent }),
        });
        if (agent !== undefined) {
          await dependencies.onAgentApprovalExecuted?.({ approval, principal, response });
        }
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

/** A ceiling entry no capability matches: an agent with no effective capability executes nothing. */
const NO_EFFECTIVE_CAPABILITY = 'agent.no_effective_capability';

/** Streams an orchestrator response as SSE (`meta` → `delta*` → `done`). */
async function streamChatResponse(
  reply: FastifyReply,
  response: OrchestratorResponse,
): Promise<void> {
  reply.hijack();
  const raw = reply.raw;

  /** Write an SSE frame, swallowing a write after the client disconnected. */
  const safeWrite = (frame: string): boolean => {
    if (raw.writableEnded || raw.destroyed) {
      return false;
    }
    try {
      raw.write(frame);
      return true;
    } catch {
      return false;
    }
  };

  raw.writeHead(200, {
    'content-type': 'text/event-stream',
    'cache-control': 'no-cache, no-transform',
    connection: 'keep-alive',
    'x-accel-buffering': 'no',
  });
  safeWrite(
    formatSse('meta', {
      runId: response.runId,
      conversationId: response.conversationId,
      intent: response.intent,
    }),
  );
  for (const chunk of chunkText(response.response)) {
    // Stop pacing the moment the client goes away — the run already
    // executed; there is nothing left to compute, only bytes to send.
    if (!safeWrite(formatSse('delta', { text: chunk }))) {
      return;
    }
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
    ...(response.sources === undefined || response.sources.length === 0
      ? {}
      : { sources: response.sources }),
    steps: response.steps.map((step) => ({
      stepId: step.stepId,
      capabilityId: step.capabilityId,
      toolId: step.toolId,
      status: step.status,
      output: step.output,
      ...(step.errorCode === undefined ? {} : { errorCode: step.errorCode }),
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
      ...(approval.expiresAt === undefined ? {} : { expiresAt: approval.expiresAt }),
      ...(approval.requiredApproverRoleId === undefined
        ? {}
        : { requiredApproverRoleId: approval.requiredApproverRoleId }),
      ...(approval.separationOfDuties === undefined
        ? {}
        : { separationOfDuties: approval.separationOfDuties }),
    })),
  };
  safeWrite(formatSse('done', done));
  if (!raw.writableEnded) {
    raw.end();
  }
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
