/**
 * @nexora/app-api — agent session binding (Prompt 4).
 *
 * Validates a request to operate AS a persisted agent from an external
 * surface (the remote MCP `X-Nexora-Agent` header, the stdio MCP
 * `NEXORA_MCP_AGENT_ID`). The agent id is only a LOOKUP KEY: the agent must
 * exist in the caller's organization (a foreign or fabricated id resolves to
 * nothing), belong to the session's workspace, be active, and the caller must
 * hold `agent.execute` there. The session is then bounded by the agent's
 * CURRENT effective capabilities, and every tool call is re-authorized
 * against its delegations at execution time by the ToolExecutor.
 */

import type { SecurityReasonCode } from '@nexora/ai-runtime/execution';
import type { AgentIdentityRepository, AgentIdentityService } from '@nexora/module-agents';

import {
  authorizePermission,
  type PermissionResolverDependencies,
} from '../business-context/permissions.js';

/** The outcome of an agent session binding. */
export type AgentSessionResolution =
  | {
      ok: true;
      agent: { agentId: string; definitionId: string; name: string };
      effectiveCapabilityIds: readonly string[];
    }
  | { ok: false; reasonCode: SecurityReasonCode; message: string };

/** Builds the agent session resolver shared by the HTTP and stdio MCP surfaces. */
export function createAgentSessionResolver(dependencies: {
  agents: AgentIdentityRepository;
  identities: AgentIdentityService;
  permissions: PermissionResolverDependencies;
}): (input: {
  userId: string;
  tenantId: string;
  workspaceId: string;
  agentId: string;
}) => Promise<AgentSessionResolution> {
  return async (input) => {
    const authz = await authorizePermission(
      dependencies.permissions,
      { userId: input.userId, tenantId: input.tenantId, workspaceId: input.workspaceId },
      'agent.execute',
    );
    if (!authz.ok) {
      return {
        ok: false,
        reasonCode: 'CAPABILITY_NOT_PERMITTED',
        message: 'Your current role does not have permission to operate agents',
      };
    }
    const agent = await dependencies.agents.findById(input.tenantId, input.agentId);
    if (agent === undefined) {
      return { ok: false, reasonCode: 'AGENT_NOT_FOUND', message: 'Agent not found' };
    }
    if (agent.workspaceId !== input.workspaceId) {
      return {
        ok: false,
        reasonCode: 'AGENT_OUT_OF_SCOPE',
        message: 'The agent does not belong to this workspace',
      };
    }
    if (agent.status !== 'active') {
      return {
        ok: false,
        reasonCode: agent.status === 'suspended' ? 'AGENT_SUSPENDED' : 'AGENT_REVOKED',
        message: `The agent is ${agent.status}`,
      };
    }
    const view = await dependencies.identities.inspectAgent(
      {
        userId: input.userId,
        organizationId: input.tenantId,
        workspaceId: input.workspaceId,
        capabilityIds: [],
      },
      agent.id,
    );
    return {
      ok: true,
      agent: { agentId: agent.id, definitionId: agent.definitionId, name: agent.name },
      effectiveCapabilityIds: view.ok ? view.view.effectiveCapabilityIds : [],
    };
  };
}
