/**
 * @nexora/module-agents — BusinessAgentApplicationService (S26 Phase 8).
 *
 * The generic business-agent engine surface: it resolves the caller's
 * EFFECTIVE business role through the {@link BusinessAgentRoleResolver}
 * port (implemented by the API layer from trusted membership — never from
 * URL/query/body/AI/frontend state), resolves the bound agent definition,
 * derives the agent's capability set, and produces governed
 * {@link ActionProposal}s through the {@link AgentProposalProvider} port
 * (implemented by the API layer over the EXISTING application services —
 * measurements, activity, notifications, projects, knowledge — never a
 * second data-access layer).
 *
 * Phase 8 execution: the engine turns a proposal (or a free-form intent)
 * into a capability-bound {@link AgentExecutionIntent} and hands it to the
 * {@link AgentExecutionPort} — the API layer's adapter over the EXISTING
 * Enterprise AI Runtime. The engine NEVER executes anything itself; the
 * runtime's discovery is restricted to `allowedCapabilityIds` and every
 * write stays gated by the existing ApprovalEngine. Outcomes are journaled
 * through the {@link AgentExecutionRecorder} port (measurements).
 *
 * The engine is domain-agnostic: it understands definitions, not job
 * titles. A new role registers an agent in the registry and the same engine
 * resolves it. No authorization lives here — the role resolver and every
 * proposal data source keep enforcing the existing tenant/workspace/
 * authorization model.
 *
 * Security contract (S26): an agent can never self-grant capabilities,
 * change its role/domain, or bypass approval. Definitions grant nothing.
 * Every execution intent is bounded to the agent's registered capability
 * set before the runtime ever sees it (fail closed), and a proposal whose
 * required capability is outside the agent set is rejected outright.
 */

import { prefixedId } from '@nexora/shared/ids';
import { nowIso } from '@nexora/shared/time';
import type {
  ActionProposal,
  AgentAutonomyLevel,
  AgentExecutionIntent,
  AgentExecutionOutcome,
  AgentExecutionRecord,
  BusinessAgentDefinition,
  BusinessAgentDto,
} from '@nexora/contracts/agent';
import type { BusinessAgentRegistry } from '../registry/business-agent-registry.js';
import type { AgentExecutionPort, AgentExecutionRecorder } from './agent-execution-port.js';

/** The trusted context every resolution derives from. */
export interface BusinessAgentContext {
  /** The authenticated user (trusted). */
  userId: string;
  /** The tenant (organization) scope (trusted). */
  tenantId: string;
  /** The verified workspace scope, when present (trusted). */
  workspaceId?: string;
}

/**
 * Resolves the caller's EFFECTIVE business role id from trusted context.
 * Implemented by the API layer from trusted membership (the same seam the
 * Command Center and the AI Runtime use) — a role supplied by the client is
 * never consulted.
 */
export interface BusinessAgentRoleResolver {
  /** Returns the business role id (e.g. `technology.developer`), or `undefined`. */
  resolve(context: BusinessAgentContext): Promise<string | undefined>;
}

/**
 * Produces governed action proposals for an agent. Implemented by the API
 * layer over the EXISTING application services — every proposal is derived
 * from REAL persisted data (never fabricated). The provider receives the
 * trusted context and the resolved agent, and returns the proposals.
 */
export interface AgentProposalProvider {
  propose(
    context: BusinessAgentContext,
    agent: BusinessAgentDefinition,
  ): Promise<readonly ActionProposal[]>;
}

/** The Phase 1 catalog surface the service needs for display names. */
export interface BusinessAgentDomainCatalogPort {
  domains: { get(id: string): { name: string } | undefined };
  roles: { get(id: string): { name: string } | undefined };
}

/** Dependencies of the {@link BusinessAgentApplicationService}. */
export interface BusinessAgentApplicationServiceDependencies {
  /** The registered agent definitions. */
  registry: BusinessAgentRegistry;
  /** The Phase 1 domain catalog (display names only). */
  catalog: BusinessAgentDomainCatalogPort;
  /** The trusted role resolver (membership → business role). */
  roleResolver: BusinessAgentRoleResolver;
  /** The governed proposal provider (over existing application services). */
  proposalProvider: AgentProposalProvider;
  /**
   * The governed execution port (over the EXISTING AI Runtime). When
   * absent, execution is not configured and requests fail safely with
   * `not-configured` (never a partial run).
   */
  execution?: AgentExecutionPort;
  /**
   * The persisted execution journal (measurements). When absent, executions
   * still run but are not recorded (tests/dev defaults).
   */
  recorder?: AgentExecutionRecorder;
}

/** The outcome of resolving a business agent. */
export type ResolveBusinessAgentResult =
  { ok: true; agent: BusinessAgentDto } | { ok: false; reason: 'no-role' | 'no-agent' };

/** The outcome of executing a governed agent intent. */
export type ExecuteBusinessAgentResult =
  | { ok: true; agent: BusinessAgentDto; outcome: AgentExecutionOutcome }
  | {
      ok: false;
      reason: 'no-role' | 'no-agent' | 'no-proposal' | 'capability-escalation' | 'not-configured';
    };

/** An execution request: by proposal id, or as a free-form intent. */
export interface ExecuteBusinessAgentRequest {
  /** Execute a governed proposal (re-derived and validated server-side). */
  proposalId?: string;
  /** Execute a free-form intent bound to the agent's capability set. */
  utterance?: string;
}

/** The maximum number of journal entries returned in the agent DTO. */
const RECENT_RUNS_LIMIT = 10;

/** The generic business-agent application service. */
export class BusinessAgentApplicationService {
  readonly #registry: BusinessAgentRegistry;
  readonly #catalog: BusinessAgentDomainCatalogPort;
  readonly #roleResolver: BusinessAgentRoleResolver;
  readonly #proposalProvider: AgentProposalProvider;
  readonly #execution?: AgentExecutionPort;
  readonly #recorder?: AgentExecutionRecorder;

  constructor(dependencies: BusinessAgentApplicationServiceDependencies) {
    this.#registry = dependencies.registry;
    this.#catalog = dependencies.catalog;
    this.#roleResolver = dependencies.roleResolver;
    this.#proposalProvider = dependencies.proposalProvider;
    this.#execution = dependencies.execution;
    this.#recorder = dependencies.recorder;
  }

  /**
   * Resolves the caller's business agent: trusted role → definition →
   * governed proposals → typed DTO. Fails safely (`no-role` / `no-agent`)
   * when the caller has no business role or the role has no agent
   * registered — never an error leaking internals.
   */
  async resolve(context: BusinessAgentContext): Promise<ResolveBusinessAgentResult> {
    const roleId = await this.#roleResolver.resolve(context);
    if (roleId === undefined) {
      return { ok: false, reason: 'no-role' };
    }
    const definition = this.#registry.resolveByRole(roleId);
    if (definition === undefined) {
      return { ok: false, reason: 'no-agent' };
    }
    const [proposals, recentRuns] = await Promise.all([
      this.#proposalProvider.propose(context, definition),
      this.#recorder === undefined
        ? Promise.resolve([] as readonly AgentExecutionRecord[])
        : this.#recorder.listRecent(context, RECENT_RUNS_LIMIT),
    ]);
    return {
      ok: true,
      agent: toBusinessAgentDto(definition, proposals, recentRuns, roleId, this.#catalog),
    };
  }

  /**
   * Executes a governed agent intent through the {@link AgentExecutionPort}.
   *
   * A proposal execution re-derives the agent's proposals from REAL data,
   * resolves the requested proposal id, and validates its required
   * capability is INSIDE the agent's registered set (fail closed — a forged
   * proposal id or a capability escalation attempt resolves to an explicit
   * rejection, never to a run). A free-form execution binds the run to the
   * agent's entire registered capability set. The port (the existing AI
   * Runtime) enforces the same bound during discovery, so the engine's
   * validation and the runtime's discovery can never disagree.
   */
  async execute(
    context: BusinessAgentContext,
    request: ExecuteBusinessAgentRequest,
  ): Promise<ExecuteBusinessAgentResult> {
    const roleId = await this.#roleResolver.resolve(context);
    if (roleId === undefined) {
      return { ok: false, reason: 'no-role' };
    }
    const definition = this.#registry.resolveByRole(roleId);
    if (definition === undefined) {
      return { ok: false, reason: 'no-agent' };
    }
    if (this.#execution === undefined) {
      return { ok: false, reason: 'not-configured' };
    }

    const intent = await this.#resolveIntent(context, definition, request);
    if (intent.kind === 'rejected') {
      return { ok: false, reason: intent.reason };
    }

    const outcome = await this.#execution.execute(context, intent.intent);

    // Journal the run (measurements) when a recorder is configured. The
    // record is a fact of what happened — never fabricated.
    if (this.#recorder !== undefined) {
      await this.#recorder.record({
        id: prefixedId('agx'),
        agentId: definition.id,
        roleId,
        domainId: definition.domainId,
        tenantId: context.tenantId,
        workspaceId: context.workspaceId,
        userId: context.userId,
        proposalId: intent.intent.proposal?.id,
        proposalAction: intent.intent.proposal?.action,
        status: outcome.status,
        runId: outcome.runId,
        reason: outcome.status === 'completed' ? undefined : outcome.response.slice(0, 500),
        createdAt: nowIso(),
      });
    }

    const [proposals, recentRuns] = await Promise.all([
      this.#proposalProvider.propose(context, definition),
      this.#recorder === undefined
        ? Promise.resolve([] as readonly AgentExecutionRecord[])
        : this.#recorder.listRecent(context, RECENT_RUNS_LIMIT),
    ]);
    return {
      ok: true,
      agent: toBusinessAgentDto(definition, proposals, recentRuns, roleId, this.#catalog),
      outcome,
    };
  }

  /**
   * Resolves the capability-bound execution intent for a request. Fail
   * closed: a proposal whose required capability is outside the agent's set
   * is rejected before any execution.
   */
  async #resolveIntent(
    context: BusinessAgentContext,
    agent: BusinessAgentDefinition,
    request: ExecuteBusinessAgentRequest,
  ): Promise<
    | { kind: 'intent'; intent: AgentExecutionIntent }
    | { kind: 'rejected'; reason: 'no-proposal' | 'capability-escalation' }
  > {
    if (request.proposalId !== undefined) {
      const proposals = await this.#proposalProvider.propose(context, agent);
      const proposal = proposals.find((p) => p.id === request.proposalId);
      if (proposal === undefined) {
        return { kind: 'rejected', reason: 'no-proposal' };
      }
      if (!agent.capabilityIds.includes(proposal.requiredCapability)) {
        // A forged proposal can never escalate beyond the agent's set.
        return { kind: 'rejected', reason: 'capability-escalation' };
      }
      return {
        kind: 'intent',
        intent: {
          agentId: agent.id,
          roleId: agent.roleId,
          domainId: agent.domainId,
          proposal,
          utterance: `${proposal.action}: ${proposal.reason}`,
          allowedCapabilityIds: [proposal.requiredCapability],
        },
      };
    }
    const utterance = request.utterance?.trim() ?? '';
    if (utterance.length === 0) {
      return { kind: 'rejected', reason: 'no-proposal' };
    }
    return {
      kind: 'intent',
      intent: {
        agentId: agent.id,
        roleId: agent.roleId,
        domainId: agent.domainId,
        utterance: utterance.slice(0, 4000),
        allowedCapabilityIds: [...agent.capabilityIds],
      },
    };
  }
}

/** Handles the business-agent query. */
export class GetBusinessAgentHandler {
  readonly #service: BusinessAgentApplicationService;

  constructor(service: BusinessAgentApplicationService) {
    this.#service = service;
  }

  handle(context: BusinessAgentContext): Promise<ResolveBusinessAgentResult> {
    return this.#service.resolve(context);
  }
}

/** Handles a governed business-agent execution. */
export class ExecuteBusinessAgentHandler {
  readonly #service: BusinessAgentApplicationService;

  constructor(service: BusinessAgentApplicationService) {
    this.#service = service;
  }

  handle(
    context: BusinessAgentContext,
    request: ExecuteBusinessAgentRequest,
  ): Promise<ExecuteBusinessAgentResult> {
    return this.#service.execute(context, request);
  }
}

/** Composes the typed agent DTO (definition + proposals + runs + context names). */
function toBusinessAgentDto(
  def: BusinessAgentDefinition,
  proposals: readonly ActionProposal[],
  recentRuns: readonly AgentExecutionRecord[],
  roleId: string,
  catalog: BusinessAgentDomainCatalogPort,
): BusinessAgentDto {
  const domain = catalog.domains.get(def.domainId);
  const role = catalog.roles.get(roleId);
  return {
    id: def.id,
    name: def.name,
    domainId: def.domainId,
    domainName: domain?.name ?? def.domainId,
    roleId,
    roleName: role?.name ?? roleId,
    description: def.description,
    autonomyLevel: def.autonomyLevel as AgentAutonomyLevel,
    goals: def.goals,
    policies: def.policies,
    capabilities: def.capabilityIds.map((capabilityId) => ({
      id: capabilityId,
      name: capabilityId,
    })),
    proposals,
    recentRuns,
  };
}
