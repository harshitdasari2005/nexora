/**
 * @nexora/app-api — the execution-time agent authority adapter (Prompt 4).
 *
 * Implements the AI Runtime's {@link AgentAuthorityPort} over the PERSISTED
 * agent identity and delegations. Called by the ToolExecutor for every tool
 * invocation that runs as an agent — at execution time, so revocation,
 * expiry, suspension, a role change of the initiating user or the grantor,
 * and resource scope all apply to the very call being made (not to a plan
 * or an approval made earlier).
 *
 * Every input is trusted server state: the agent is re-loaded by id inside
 * the run's organization (a foreign or fabricated id resolves to nothing),
 * the humans' authority is re-derived from membership + the role catalog,
 * and touched resources come from tenant-scoped reads. The decision itself
 * is the pure {@link evaluateAgentAuthority} — one rule, shared with the
 * management views.
 */

import type {
  AgentAuthorityCheck,
  AgentAuthorityPort,
  AgentAuthorityRequest,
} from '@nexora/ai-runtime/execution';
import type { BusinessAgentDefinition } from '@nexora/contracts/agent';
import {
  evaluateAgentAuthority,
  type AgentDelegationRepository,
  type AgentIdentityRepository,
  type InvocationResources,
} from '@nexora/module-agents';

/** Dependencies of {@link ApiAgentAuthority}. */
export interface ApiAgentAuthorityDependencies {
  agents: AgentIdentityRepository;
  delegations: AgentDelegationRepository;
  definitions: { get(id: string): BusinessAgentDefinition | undefined };
  /** A user's CURRENT executable capabilities in a workspace (membership → role → catalog). */
  capabilitiesOf: (input: {
    userId: string;
    organizationId: string;
    workspaceId: string;
  }) => Promise<readonly string[]>;
  /** Which resources an invocation touches (trusted reads). */
  resolveResources: (request: {
    capabilityId: string;
    input: Record<string, unknown>;
    tenantId: string;
    workspaceId?: string;
  }) => Promise<InvocationResources>;
  /** The authority clock (shared with delegation management). */
  now: () => Date;
}

/** The execution-time agent authority (see module docs). */
export class ApiAgentAuthority implements AgentAuthorityPort {
  readonly #deps: ApiAgentAuthorityDependencies;

  constructor(dependencies: ApiAgentAuthorityDependencies) {
    this.#deps = dependencies;
  }

  async authorize(request: AgentAuthorityRequest): Promise<AgentAuthorityCheck> {
    const agent = await this.#deps.agents.findById(request.tenantId, request.agent.agentId);
    // The principal context must describe the persisted agent exactly.
    if (agent !== undefined && agent.definitionId !== request.agent.definitionId) {
      return {
        ok: false,
        reasonCode: 'FORGED_AGENT_CONTEXT',
        reason: 'the agent context does not match the persisted agent identity',
      };
    }
    const workspaceId = request.workspaceId;
    const delegations =
      agent === undefined
        ? []
        : await this.#deps.delegations.listByAgent(agent.organizationId, agent.id);
    const initiatorCapabilityIds =
      workspaceId === undefined
        ? []
        : await this.#deps.capabilitiesOf({
            userId: request.userId,
            organizationId: request.tenantId,
            workspaceId,
          });
    const grantors = new Map<string, readonly string[]>();
    if (agent !== undefined) {
      for (const delegation of delegations) {
        if (
          delegation.capabilityId === request.capabilityId &&
          !grantors.has(delegation.grantedByUserId)
        ) {
          grantors.set(
            delegation.grantedByUserId,
            await this.#deps.capabilitiesOf({
              userId: delegation.grantedByUserId,
              organizationId: agent.organizationId,
              workspaceId: agent.workspaceId,
            }),
          );
        }
      }
    }
    const resources = await this.#deps.resolveResources({
      capabilityId: request.capabilityId,
      input: request.input,
      tenantId: request.tenantId,
      ...(workspaceId === undefined ? {} : { workspaceId }),
    });
    const decision = evaluateAgentAuthority({
      agent,
      run: {
        organizationId: request.tenantId,
        ...(workspaceId === undefined ? {} : { workspaceId }),
        initiatingUserId: request.userId,
      },
      capabilityId: request.capabilityId,
      resources,
      delegations,
      definitionCapabilityIds:
        agent === undefined
          ? undefined
          : this.#deps.definitions.get(agent.definitionId)?.capabilityIds,
      initiatorCapabilityIds,
      grantorCapabilityIds: (userId) => grantors.get(userId) ?? [],
      now: this.#deps.now(),
    });
    if (decision.ok) {
      return { ok: true, delegationId: decision.delegation.id };
    }
    return { ok: false, reasonCode: decision.denial, reason: decision.reason };
  }
}
