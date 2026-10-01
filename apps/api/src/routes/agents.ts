/**
 * @nexora/app-api — agent identity + delegated capability routes (Prompt 4).
 *
 *   GET  /api/agents                                         list the workspace's agents   (agent.use)
 *   POST /api/agents                                         create an agent identity      (agents.manage)
 *   GET  /api/agents/:agentId                                inspect an agent's authority  (agent.use)
 *   POST /api/agents/:agentId/suspend | reactivate | revoke  change agent status           (agents.manage)
 *   POST /api/agents/:agentId/delegations                    grant ONE capability          (agents.manage)
 *   POST /api/agents/:agentId/delegations/:id/revoke         revoke a delegation           (agents.manage)
 *   POST /api/agents/:agentId/execute                        run a free-form intent AS the agent (agent.execute)
 *   POST /api/agents/:agentId/proposals/:proposalId/execute  run a proposal AS the agent  (agent.execute)
 *
 * Every endpoint: authentication → STRICT trusted scope (the organization
 * and workspace must be the caller's own — a foreign id is 403, never a
 * silent fallback; agents are workspace-bound so a workspace is required)
 * → RBAC permission → the application service (tenant + workspace scoped,
 * fail closed) → audit. Delegation refusals and agent-principal refusals
 * are recorded as `ai.security.blocked` security decisions. No request can
 * name the caller's capabilities, role, owner authority, or approval state:
 * the actor's authority is re-derived server-side on every call.
 */

import type { FastifyInstance, FastifyReply, FastifyRequest, FastifySchema } from 'fastify';
import type { TenantId, UserId, WorkspaceId } from '@nexora/contracts/common';
import type { AgentResourceScope } from '@nexora/contracts/agent';
import type { SecurityDecisionSink, SecurityReasonCode } from '@nexora/ai-runtime/execution';
import type { ListOrganizationsHandler } from '@nexora/application-organizations';
import type { ListMyWorkspacesHandler } from '@nexora/application-workspaces';
import type {
  AgentIdentityService,
  AgentManagementActor,
  AgentManagementError,
  AgentManagementFailure,
  ExecuteBusinessAgentHandler,
  ExecuteBusinessAgentResult,
} from '@nexora/module-agents';

import { requireAuth } from '../plugins/auth.js';
import {
  authorizePermission,
  type PermissionResolverDependencies,
} from '../business-context/permissions.js';
import { sendForbidden } from './permission-response.js';

/** Dependencies of the agent identity routes. */
export interface AgentIdentityRoutesDependencies {
  identities: AgentIdentityService;
  executeAgent: ExecuteBusinessAgentHandler;
  listOrganizations: ListOrganizationsHandler;
  listMyWorkspaces: ListMyWorkspacesHandler;
  permissions: PermissionResolverDependencies;
  /** The caller's CURRENT executable capabilities in a workspace. */
  capabilitiesOf: (input: {
    userId: string;
    organizationId: string;
    workspaceId: string;
  }) => Promise<readonly string[]>;
  /** Records refused agent operations in the audit trail. */
  securitySink?: SecurityDecisionSink;
}

const scopeQuery: FastifySchema['querystring'] = {
  type: 'object',
  required: ['organizationId', 'workspaceId'],
  properties: {
    organizationId: { type: 'string', minLength: 1 },
    workspaceId: { type: 'string', minLength: 1 },
  },
};

const agentParams: FastifySchema['params'] = {
  type: 'object',
  required: ['agentId'],
  additionalProperties: false,
  properties: { agentId: { type: 'string', minLength: 1, maxLength: 64 } },
};

const createAgentSchema: FastifySchema = {
  querystring: scopeQuery,
  body: {
    type: 'object',
    required: ['definitionId', 'name'],
    additionalProperties: false,
    properties: {
      definitionId: { type: 'string', minLength: 1, maxLength: 64 },
      name: { type: 'string', minLength: 1, maxLength: 120 },
      description: { type: 'string', maxLength: 2000 },
    },
  },
};

const statusSchema: FastifySchema = {
  querystring: scopeQuery,
  params: agentParams,
  body: {
    type: 'object',
    additionalProperties: false,
    properties: { reason: { type: 'string', maxLength: 500 } },
  },
};

const grantSchema: FastifySchema = {
  querystring: scopeQuery,
  params: agentParams,
  body: {
    type: 'object',
    required: ['capabilityId'],
    // Only the grant itself: WHO grants and WHERE come from the session.
    additionalProperties: false,
    properties: {
      capabilityId: { type: 'string', minLength: 1, maxLength: 128 },
      resourceScope: {
        type: 'object',
        required: ['kind', 'id'],
        additionalProperties: false,
        properties: {
          kind: { type: 'string', enum: ['project', 'budget'] },
          id: { type: 'string', minLength: 1, maxLength: 64 },
        },
      },
      expiresAt: { type: 'string', minLength: 1, maxLength: 40 },
      note: { type: 'string', maxLength: 500 },
    },
  },
};

const revokeDelegationSchema: FastifySchema = {
  querystring: scopeQuery,
  params: {
    type: 'object',
    required: ['agentId', 'delegationId'],
    additionalProperties: false,
    properties: {
      agentId: { type: 'string', minLength: 1, maxLength: 64 },
      delegationId: { type: 'string', minLength: 1, maxLength: 64 },
    },
  },
  body: {
    type: 'object',
    additionalProperties: false,
    properties: { reason: { type: 'string', maxLength: 500 } },
  },
};

const executeSchema: FastifySchema = {
  querystring: scopeQuery,
  params: agentParams,
  body: {
    type: 'object',
    required: ['utterance'],
    additionalProperties: false,
    properties: { utterance: { type: 'string', minLength: 1, maxLength: 4000 } },
  },
};

const executeProposalSchema: FastifySchema = {
  querystring: scopeQuery,
  params: {
    type: 'object',
    required: ['agentId', 'proposalId'],
    additionalProperties: false,
    properties: {
      agentId: { type: 'string', minLength: 1, maxLength: 64 },
      proposalId: { type: 'string', minLength: 1, maxLength: 128 },
    },
  },
};

/** Registers the agent identity routes. */
export function registerAgentIdentityRoutes(
  app: FastifyInstance,
  dependencies: AgentIdentityRoutesDependencies,
): void {
  /**
   * The RBAC gate of every agent route: strict trusted scope + the
   * route's permission (via authorizePermission); replies on failure.
   */
  const authorizeAgentRoute = async (
    request: FastifyRequest,
    reply: FastifyReply,
    permission: 'agent.use' | 'agents.manage' | 'agent.execute',
    label: string,
  ): Promise<AgentManagementActor | undefined> => {
    const auth = requireAuth(request);
    const query = request.query as { organizationId: string; workspaceId: string };
    const organizations = await dependencies.listOrganizations.handle({ userId: auth.userId });
    if (!organizations.ok || !organizations.value.some((org) => org.id === query.organizationId)) {
      await reply
        .code(403)
        .send(authzError(request.id, 'You are not a member of this organization'));
      return undefined;
    }
    const workspaces = await dependencies.listMyWorkspaces.handle({
      userId: auth.userId,
      organizationId: query.organizationId as TenantId,
    });
    if (!workspaces.ok || !workspaces.value.some((ws) => ws.id === query.workspaceId)) {
      await reply.code(403).send(authzError(request.id, 'You are not a member of this workspace'));
      return undefined;
    }
    const authz = await authorizePermission(
      dependencies.permissions,
      { userId: auth.userId, tenantId: query.organizationId, workspaceId: query.workspaceId },
      permission,
    );
    if (!authz.ok) {
      await sendForbidden(reply, request.id, label);
      return undefined;
    }
    return {
      userId: auth.userId,
      organizationId: query.organizationId,
      workspaceId: query.workspaceId,
      capabilityIds: await dependencies.capabilitiesOf({
        userId: auth.userId,
        organizationId: query.organizationId,
        workspaceId: query.workspaceId,
      }),
    };
  };

  const audit = async (
    actor: AgentManagementActor,
    input: {
      agentId?: string;
      delegationId?: string;
      capabilityId?: string;
      action: string;
      reasonCode: SecurityReasonCode;
      reason: string;
    },
  ): Promise<void> => {
    try {
      await dependencies.securitySink?.({
        actorId: actor.userId,
        ...(input.agentId === undefined ? {} : { agentId: input.agentId }),
        ...(input.delegationId === undefined ? {} : { delegationId: input.delegationId }),
        origin: 'agent_management',
        invocationId: input.agentId ?? input.action,
        organizationId: actor.organizationId,
        workspaceId: actor.workspaceId,
        ...(input.capabilityId === undefined ? {} : { capabilityId: input.capabilityId }),
        action: input.action,
        policyDecision: 'deny',
        reasonCode: input.reasonCode,
        reason: input.reason,
        outcome: 'blocked',
        occurredAt: new Date().toISOString(),
      });
    } catch {
      // Audit is best-effort; the refusal stands.
    }
  };

  app.get('/api/agents', { schema: { querystring: scopeQuery } }, async (request, reply) => {
    const actor = await authorizeAgentRoute(request, reply, 'agent.use', 'view agents');
    if (actor === undefined) return reply;
    return { agents: await dependencies.identities.listAgents(actor) };
  });

  app.post('/api/agents', { schema: createAgentSchema }, async (request, reply) => {
    const actor = await authorizeAgentRoute(request, reply, 'agents.manage', 'manage agents');
    if (actor === undefined) return reply;
    const body = request.body as { definitionId: string; name: string; description?: string };
    const result = await dependencies.identities.createAgent(actor, body);
    if (!result.ok) return sendManagementError(reply, request.id, result);
    return reply.code(201).send({ agent: result.agent });
  });

  app.get(
    '/api/agents/:agentId',
    { schema: { querystring: scopeQuery, params: agentParams } },
    async (request, reply) => {
      const actor = await authorizeAgentRoute(request, reply, 'agent.use', 'view agents');
      if (actor === undefined) return reply;
      const { agentId } = request.params as { agentId: string };
      const result = await dependencies.identities.inspectAgent(actor, agentId);
      if (!result.ok) return sendManagementError(reply, request.id, result);
      return result.view;
    },
  );

  for (const [path, status] of [
    ['suspend', 'suspended'],
    ['reactivate', 'active'],
    ['revoke', 'revoked'],
  ] as const) {
    app.post(`/api/agents/:agentId/${path}`, { schema: statusSchema }, async (request, reply) => {
      const actor = await authorizeAgentRoute(request, reply, 'agents.manage', 'manage agents');
      if (actor === undefined) return reply;
      const { agentId } = request.params as { agentId: string };
      const body = (request.body ?? {}) as { reason?: string };
      const result = await dependencies.identities.setAgentStatus(
        actor,
        agentId,
        status,
        body.reason,
      );
      if (!result.ok) return sendManagementError(reply, request.id, result);
      return { agent: result.agent, changed: result.changed };
    });
  }

  app.post('/api/agents/:agentId/delegations', { schema: grantSchema }, async (request, reply) => {
    const actor = await authorizeAgentRoute(request, reply, 'agents.manage', 'manage agents');
    if (actor === undefined) return reply;
    const { agentId } = request.params as { agentId: string };
    const body = request.body as {
      capabilityId: string;
      resourceScope?: AgentResourceScope;
      expiresAt?: string;
      note?: string;
    };
    const result = await dependencies.identities.grantDelegation(actor, agentId, {
      capabilityId: body.capabilityId,
      ...(body.resourceScope === undefined ? {} : { resourceScope: body.resourceScope }),
      ...(body.expiresAt === undefined ? {} : { expiresAt: body.expiresAt }),
      ...(body.note === undefined ? {} : { metadata: { note: body.note } }),
    });
    if (!result.ok) {
      const reasonCode = DELEGATION_AUDITED_FAILURES[result.failure];
      if (reasonCode !== undefined) {
        await audit(actor, {
          agentId,
          capabilityId: body.capabilityId,
          action: 'agent.delegation.grant',
          reasonCode,
          reason: result.message,
        });
      }
      return sendManagementError(reply, request.id, result);
    }
    return reply.code(201).send({ delegation: result.delegation });
  });

  app.post(
    '/api/agents/:agentId/delegations/:delegationId/revoke',
    { schema: revokeDelegationSchema },
    async (request, reply) => {
      const actor = await authorizeAgentRoute(request, reply, 'agents.manage', 'manage agents');
      if (actor === undefined) return reply;
      const { agentId, delegationId } = request.params as {
        agentId: string;
        delegationId: string;
      };
      const body = (request.body ?? {}) as { reason?: string };
      const result = await dependencies.identities.revokeDelegation(
        actor,
        agentId,
        delegationId,
        body.reason,
      );
      if (!result.ok) return sendManagementError(reply, request.id, result);
      return { delegation: result.delegation, changed: result.changed };
    },
  );

  /** Runs the agent for an ALREADY-authorized actor (the route gates first). */
  const runAgent = async (
    request: FastifyRequest,
    reply: FastifyReply,
    actor: AgentManagementActor,
    agentId: string,
    run: { utterance?: string; proposalId?: string },
  ): Promise<unknown> => {
    const result = await dependencies.executeAgent.handle(
      {
        userId: actor.userId as UserId,
        tenantId: actor.organizationId as TenantId,
        workspaceId: actor.workspaceId as WorkspaceId,
      },
      { agentId, ...run },
    );
    await auditAgentExecutionRefusal(dependencies.securitySink, {
      userId: actor.userId,
      organizationId: actor.organizationId,
      workspaceId: actor.workspaceId,
      agentId,
      result,
    });
    return sendAgentExecutionResult(reply, request.id, result);
  };

  app.post('/api/agents/:agentId/execute', { schema: executeSchema }, async (request, reply) => {
    const actor = await authorizeAgentRoute(request, reply, 'agent.execute', 'execute agents');
    if (actor === undefined) return reply;
    const { agentId } = request.params as { agentId: string };
    const body = request.body as { utterance: string };
    return runAgent(request, reply, actor, agentId, { utterance: body.utterance });
  });

  app.post(
    '/api/agents/:agentId/proposals/:proposalId/execute',
    { schema: executeProposalSchema },
    async (request, reply) => {
      const actor = await authorizeAgentRoute(request, reply, 'agent.execute', 'execute agents');
      if (actor === undefined) return reply;
      const { agentId, proposalId } = request.params as { agentId: string; proposalId: string };
      return runAgent(request, reply, actor, agentId, { proposalId });
    },
  );
}

/** Delegation refusals that are security decisions (audited). */
const DELEGATION_AUDITED_FAILURES: Partial<Record<AgentManagementFailure, SecurityReasonCode>> = {
  CAPABILITY_NOT_DELEGABLE: 'CAPABILITY_NOT_DELEGABLE',
  CAPABILITY_OUTSIDE_AGENT_DEFINITION: 'CAPABILITY_OUTSIDE_AGENT_DEFINITION',
  DELEGATION_EXCEEDS_USER_AUTHORITY: 'DELEGATION_EXCEEDS_USER_AUTHORITY',
  RESOURCE_NOT_FOUND: 'DELEGATION_RESOURCE_OUT_OF_SCOPE',
  RESOURCE_SCOPE_UNSUPPORTED: 'DELEGATION_RESOURCE_OUT_OF_SCOPE',
  AGENT_NOT_FOUND: 'AGENT_NOT_FOUND',
};

/** Agent-principal refusals at execution that are security decisions (audited). */
const EXECUTION_AUDITED_FAILURES: Partial<
  Record<Extract<ExecuteBusinessAgentResult, { ok: false }>['reason'], SecurityReasonCode>
> = {
  'agent-not-found': 'AGENT_NOT_FOUND',
  'agent-out-of-scope': 'AGENT_OUT_OF_SCOPE',
  'agent-suspended': 'AGENT_SUSPENDED',
  'agent-revoked': 'AGENT_REVOKED',
  'capability-escalation': 'CAPABILITY_OUTSIDE_AGENT_DEFINITION',
};

function authzError(requestId: string, message: string, reason?: string) {
  return {
    error: {
      code: 'AUTHORIZATION_ERROR',
      message,
      ...(reason === undefined ? {} : { reason }),
      requestId,
    },
  };
}

/** Maps a management failure to HTTP (the failure code travels as `reason`). */
function sendManagementError(
  reply: FastifyReply,
  requestId: string,
  error: AgentManagementError,
): unknown {
  const status = (() => {
    switch (error.failure) {
      case 'AGENT_NOT_FOUND':
      case 'DELEGATION_NOT_FOUND':
      case 'AGENT_OUT_OF_SCOPE':
        return 404;
      case 'CAPABILITY_NOT_DELEGABLE':
      case 'CAPABILITY_OUTSIDE_AGENT_DEFINITION':
      case 'DELEGATION_EXCEEDS_USER_AUTHORITY':
        return 403;
      case 'AGENT_NOT_ACTIVE':
      case 'AGENT_REVOKED':
        return 409;
      default:
        return 400;
    }
  })();
  const code =
    status === 404
      ? 'NOT_FOUND'
      : status === 403
        ? 'AUTHORIZATION_ERROR'
        : status === 409
          ? 'CONFLICT'
          : 'VALIDATION_ERROR';
  return reply
    .code(status)
    .send({ error: { code, message: error.message, reason: error.failure, requestId } });
}

/** Maps an agent execution result to HTTP (shared with the legacy /api/agent routes). */
export function sendAgentExecutionResult(
  reply: { code(status: number): { send(body: unknown): unknown } },
  requestId: string,
  result: ExecuteBusinessAgentResult,
): unknown {
  if (result.ok) {
    return {
      agent: result.agent,
      outcome: result.outcome,
      principal: {
        id: result.principal.id,
        name: result.principal.name,
        definitionId: result.principal.definitionId,
        status: result.principal.status,
      },
    };
  }
  const send = (status: number, code: string, message: string) =>
    reply.code(status).send({ error: { code, message, reason: result.reason, requestId } });
  switch (result.reason) {
    case 'agent-required':
      return send(400, 'VALIDATION_ERROR', 'Choose the agent identity to run (agentId)');
    case 'agent-not-found':
      return send(404, 'NOT_FOUND', 'Agent not found');
    case 'agent-out-of-scope':
      return send(403, 'AUTHORIZATION_ERROR', 'The agent does not belong to this workspace');
    case 'agent-suspended':
    case 'agent-revoked':
      return send(403, 'AUTHORIZATION_ERROR', `The agent is ${result.reason.slice(6)}`);
    case 'capability-escalation':
      return send(
        403,
        'AUTHORIZATION_ERROR',
        'The proposal requires a capability outside your agent',
      );
    case 'no-proposal':
      return send(404, 'NOT_FOUND', 'Proposal not found');
    case 'not-configured':
      return send(503, 'SERVICE_UNAVAILABLE', 'Agent execution is not configured');
    case 'no-role':
    case 'no-agent':
      return send(404, 'NOT_FOUND', 'No agent is configured for your role');
  }
}

/** Audits an agent-principal refusal at execution (shared with the legacy routes). */
export async function auditAgentExecutionRefusal(
  sink: SecurityDecisionSink | undefined,
  input: {
    userId: string;
    organizationId: string;
    workspaceId?: string;
    agentId: string | undefined;
    result: ExecuteBusinessAgentResult;
  },
): Promise<void> {
  if (input.result.ok || sink === undefined || input.agentId === undefined) {
    return;
  }
  const reasonCode = EXECUTION_AUDITED_FAILURES[input.result.reason];
  if (reasonCode === undefined) {
    return;
  }
  try {
    await sink({
      actorId: input.userId,
      agentId: input.agentId,
      origin: 'agent',
      invocationId: input.agentId,
      organizationId: input.organizationId,
      ...(input.workspaceId === undefined ? {} : { workspaceId: input.workspaceId }),
      action: 'agent.execute',
      policyDecision: 'deny',
      reasonCode,
      reason: `agent execution refused: ${input.result.reason}`,
      outcome: 'blocked',
      occurredAt: new Date().toISOString(),
    });
  } catch {
    // Audit is best-effort; the refusal stands.
  }
}
