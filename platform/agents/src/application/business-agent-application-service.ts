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
  AgentPrincipal,
  AgentAutonomyLevel,
  AgentExecutionIntent,
  AgentExecutionOutcome,
  AgentExecutionRecord,
  BusinessAgentDefinition,
  BusinessAgentDto,
} from '@nexora/contracts/agent';
import type { BusinessProblemDto } from '@nexora/contracts/detection';
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

/**
 * Resolves the caller's EFFECTIVE RBAC capability set (S34) — the SAME
 * business→executable bridge every AI surface uses, derived from the
 * caller's trusted role, never a client claim. Implemented by the API layer
 * by reusing `buildBusinessContext` (the SAME function the Command Center
 * and AI Runtime already call): `resolve(context).then(ctx => ctx?.
 * capabilityIds)`. Optional — when absent, the agent's own registered set
 * is used unintersected (today's pre-S34 behavior; every agent-bearing role
 * has an RBAC set as of S34, so this only matters for a caller that hasn't
 * wired the resolver at all, e.g. an older composition site or a test).
 */
export interface AgentPermissionResolver {
  /** Returns the caller's effective EXECUTABLE capability ids, or `undefined` when unresolvable. */
  resolve(context: BusinessAgentContext): Promise<readonly string[] | undefined>;
}

/**
 * Provides the detected business problems of the caller's scope (S27).
 * Implemented by the API layer over the detection engine; the agent DTO
 * surfaces them alongside its proposals, and problem-derived action
 * proposals merge into the agent's proposal list so they flow through the
 * SAME governed execution path. When absent, the agent surface runs
 * without the proactive layer (problems resolve to an empty list).
 */
export interface AgentProblemProvider {
  /**
   * Returns the scope's detected problems (investigation included). The
   * agent is passed so the provider can bound problem-derived action
   * proposals to the agent's registered capability set (fail closed — a
   * problem can never recommend an action beyond the agent's set).
   */
  list(
    context: BusinessAgentContext,
    agent: BusinessAgentDefinition,
  ): Promise<readonly BusinessProblemDto[]>;
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
  /**
   * The proactive problem provider (S27). When absent, the agent surface
   * runs without problems (an empty list — never fabricated).
   */
  problems?: AgentProblemProvider;
  /**
   * Resolves the caller's EFFECTIVE RBAC capability set (S34). When present,
   * EVERY capability-bearing surface of this service (the advertised DTO,
   * proposal validation, free-form execution's ceiling) is bound to
   * `intersection(agent.capabilityIds, rbacCapabilityIds)` — never the
   * agent's own set alone (which would let the agent's static configuration
   * outrun the caller's REAL permission, a union rather than an
   * intersection). Absent falls back to the agent's own set unintersected.
   */
  permissionResolver?: AgentPermissionResolver;
  /** Resolves persisted agent principals (Prompt 4). Execution fails closed without it. */
  principals?: AgentPrincipalResolver;
}

/** The outcome of resolving a business agent. */
export type ResolveBusinessAgentResult =
  { ok: true; agent: BusinessAgentDto } | { ok: false; reason: 'no-role' | 'no-agent' };

/**
 * The outcome of resolving ONLY the agent's registered capability set (no
 * proposals, no problems, no journal — a pure read used by surfaces that
 * need the capability bound without the DTO side effects, e.g. the S27
 * problems console listing without re-evaluating signals).
 */
export type ResolveAgentCapabilitiesResult =
  { ok: true; capabilityIds: readonly string[] } | { ok: false; reason: 'no-role' | 'no-agent' };

/**
 * The outcome of resolving ONLY the agent's identity + capability bound (no
 * proposals, no problems, no journal — a pure read used by surfaces that
 * need the agent definition without the DTO side effects, e.g. the Phase 10
 * remediation engine deriving a plan's executing agent).
 */
export type ResolveBusinessAgentDefinitionResult =
  | {
      ok: true;
      agent: {
        id: BusinessAgentDefinition['id'];
        roleId: BusinessAgentDefinition['roleId'];
        domainId: BusinessAgentDefinition['domainId'];
        capabilityIds: readonly string[];
      };
    }
  | { ok: false; reason: 'no-role' | 'no-agent' };

/** The outcome of executing a governed agent intent. */
export type ExecuteBusinessAgentResult =
  | { ok: true; agent: BusinessAgentDto; outcome: AgentExecutionOutcome; principal: AgentPrincipal }
  | {
      ok: false;
      reason:
        | 'no-role'
        | 'no-agent'
        | 'no-proposal'
        | 'capability-escalation'
        | 'not-configured'
        | 'agent-required'
        | 'agent-not-found'
        | 'agent-out-of-scope'
        | 'agent-suspended'
        | 'agent-revoked';
      /** The persisted agent, when it was resolved (for audit attribution). */
      principal?: AgentPrincipal;
    };

/**
 * Resolves the persisted AGENT PRINCIPAL a run executes as (Prompt 4) — by
 * id, inside the caller's trusted organization only (a foreign or fabricated
 * id resolves to `undefined`).
 */
export interface AgentPrincipalResolver {
  findById(organizationId: string, agentId: string): Promise<AgentPrincipal | undefined>;
}

/** An execution request: by proposal id, or as a free-form intent. */
export interface ExecuteBusinessAgentRequest {
  /**
   * The persisted agent identity to run as (Prompt 4) — REQUIRED for
   * execution: an agent never acts as "the caller's role". Resolved and
   * validated server-side (tenant, workspace, status).
   */
  agentId?: string;
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
  readonly #problems?: AgentProblemProvider;
  readonly #permissionResolver?: AgentPermissionResolver;
  readonly #principals?: AgentPrincipalResolver;

  constructor(dependencies: BusinessAgentApplicationServiceDependencies) {
    this.#registry = dependencies.registry;
    this.#catalog = dependencies.catalog;
    this.#roleResolver = dependencies.roleResolver;
    this.#proposalProvider = dependencies.proposalProvider;
    this.#execution = dependencies.execution;
    this.#recorder = dependencies.recorder;
    this.#problems = dependencies.problems;
    this.#permissionResolver = dependencies.permissionResolver;
    this.#principals = dependencies.principals;
  }

  /**
   * Binds a resolved agent definition to `intersection(agent.capabilityIds,
   * effective RBAC capability ids)` (S34) — never the agent's set alone.
   * Every downstream read (the advertised DTO, proposal validation,
   * free-form execution's ceiling) uses this bounded copy, not the raw
   * registry definition, so the intersection is enforced exactly once per
   * request and can never be bypassed by a code path that forgot to apply
   * it. Falls back to the agent's own set unintersected when no permission
   * resolver is wired (pre-S34 composition sites, tests).
   */
  async #bindToEffectivePermissions(
    context: BusinessAgentContext,
    definition: BusinessAgentDefinition,
    options: { failClosed?: boolean } = {},
  ): Promise<BusinessAgentDefinition> {
    if (this.#permissionResolver === undefined) {
      // Composition choice (tests/older sites): no resolver is wired at all.
      return definition;
    }
    const rbacCapabilityIds = await this.#permissionResolver.resolve(context);
    if (rbacCapabilityIds === undefined) {
      // Read-only display surfaces keep the pre-S34 fallback; an EXECUTION
      // must never run on a definition whose caller authority is unknown
      // (an empty ceiling is "no authority", never "unrestricted").
      return options.failClosed === true ? { ...definition, capabilityIds: [] } : definition;
    }
    const allowed = new Set(rbacCapabilityIds);
    return {
      ...definition,
      capabilityIds: definition.capabilityIds.filter((id) => allowed.has(id)),
    };
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
    const registered = this.#registry.resolveByRole(roleId);
    if (registered === undefined) {
      return { ok: false, reason: 'no-agent' };
    }
    const definition = await this.#bindToEffectivePermissions(context, registered);
    const [proposals, recentRuns, problems] = await Promise.all([
      this.#proposalProvider.propose(context, definition),
      this.#recorder === undefined
        ? Promise.resolve([] as readonly AgentExecutionRecord[])
        : this.#recorder.listRecent(context, RECENT_RUNS_LIMIT),
      this.#loadProblems(context, definition),
    ]);
    return {
      ok: true,
      agent: toBusinessAgentDto(
        definition,
        this.#mergeProblemProposals(proposals, problems),
        recentRuns,
        problems,
        roleId,
        this.#catalog,
      ),
    };
  }

  /**
   * Resolves ONLY the agent's registered capability set for the trusted
   * context — the same membership → role → agent seam, but with none of the
   * DTO side effects (no proposal derivation, no problem provider scan, no
   * journal reads). Consumed by surfaces that must bound capabilities
   * without re-evaluating detection signals (S27 problems console).
   */
  async resolveCapabilities(
    context: BusinessAgentContext,
  ): Promise<ResolveAgentCapabilitiesResult> {
    const roleId = await this.#roleResolver.resolve(context);
    if (roleId === undefined) {
      return { ok: false, reason: 'no-role' };
    }
    const registered = this.#registry.resolveByRole(roleId);
    if (registered === undefined) {
      return { ok: false, reason: 'no-agent' };
    }
    const definition = await this.#bindToEffectivePermissions(context, registered);
    return { ok: true, capabilityIds: [...definition.capabilityIds] };
  }

  /**
   * Resolves ONLY the agent definition (id/role/domain/capability set) for
   * the trusted context — the same membership → role → agent seam, with
   * none of the DTO side effects. Consumed by surfaces that derive plans
   * and bound proposals without re-evaluating detection signals (Phase 10
   * remediation).
   */
  async resolveDefinition(
    context: BusinessAgentContext,
  ): Promise<ResolveBusinessAgentDefinitionResult> {
    const roleId = await this.#roleResolver.resolve(context);
    if (roleId === undefined) {
      return { ok: false, reason: 'no-role' };
    }
    const registered = this.#registry.resolveByRole(roleId);
    if (registered === undefined) {
      return { ok: false, reason: 'no-agent' };
    }
    const definition = await this.#bindToEffectivePermissions(context, registered);
    return {
      ok: true,
      agent: {
        id: definition.id,
        roleId: definition.roleId,
        domainId: definition.domainId,
        capabilityIds: [...definition.capabilityIds],
      },
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
    // Prompt 4: execution runs AS a persisted agent principal — never as
    // "whatever agent the caller's role maps to". Fail closed without one.
    if (request.agentId === undefined || request.agentId.trim().length === 0) {
      return { ok: false, reason: 'agent-required' };
    }
    if (this.#principals === undefined || this.#execution === undefined) {
      return { ok: false, reason: 'not-configured' };
    }
    const principal = await this.#principals.findById(context.tenantId, request.agentId);
    if (principal === undefined) {
      return { ok: false, reason: 'agent-not-found' };
    }
    if (principal.workspaceId !== context.workspaceId) {
      // An agent acts only inside its own workspace — a run requested from
      // any other scope (or with no workspace) is refused.
      return { ok: false, reason: 'agent-out-of-scope', principal };
    }
    if (principal.status === 'suspended') {
      return { ok: false, reason: 'agent-suspended', principal };
    }
    if (principal.status === 'revoked') {
      return { ok: false, reason: 'agent-revoked', principal };
    }
    const roleId = await this.#roleResolver.resolve(context);
    if (roleId === undefined) {
      return { ok: false, reason: 'no-role', principal };
    }
    // The definition comes from the AGENT, not from the caller's role.
    const registered = this.#registry.get(principal.definitionId);
    if (registered === undefined) {
      return { ok: false, reason: 'no-agent', principal };
    }
    // Discovery bound: the definition ceiling ∩ the caller's CURRENT role.
    // Delegations are enforced per step — before any approval opens and
    // again at execution time — so a missing/revoked/expired delegation is
    // an explicit, audited denial rather than a silent narrowing.
    const definition = await this.#bindToEffectivePermissions(context, registered, {
      failClosed: true,
    });

    const intent = await this.#resolveIntent(context, definition, request);
    if (intent.kind === 'rejected') {
      return { ok: false, reason: intent.reason, principal };
    }

    const outcome = await this.#execution.execute(context, {
      ...intent.intent,
      agent: { agentId: principal.id, definitionId: principal.definitionId, name: principal.name },
    });
    const delegationIds = [
      ...new Set(
        outcome.steps
          .map((step) => step.delegationId)
          .filter((id): id is string => id !== undefined),
      ),
    ].sort();

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
        agentIdentityId: principal.id,
        ...(delegationIds.length === 0 ? {} : { delegationIds }),
        status: outcome.status,
        runId: outcome.runId,
        reason: outcome.status === 'completed' ? undefined : outcome.response.slice(0, 500),
        createdAt: nowIso(),
      });
    }

    const [proposals, recentRuns, problems] = await Promise.all([
      this.#proposalProvider.propose(context, definition),
      this.#recorder === undefined
        ? Promise.resolve([] as readonly AgentExecutionRecord[])
        : this.#recorder.listRecent(context, RECENT_RUNS_LIMIT),
      this.#loadProblems(context, definition),
    ]);
    return {
      ok: true,
      agent: toBusinessAgentDto(
        definition,
        this.#mergeProblemProposals(proposals, problems),
        recentRuns,
        problems,
        roleId,
        this.#catalog,
      ),
      outcome,
      principal,
    };
  }

  /** Loads the scope's problems (fail safe — a broken provider is empty). */
  async #loadProblems(
    context: BusinessAgentContext,
    agent: BusinessAgentDefinition,
  ): Promise<readonly BusinessProblemDto[]> {
    if (this.#problems === undefined) {
      return [];
    }
    try {
      return await this.#problems.list(context, agent);
    } catch {
      return [];
    }
  }

  /**
   * Merges the problem-derived action proposals into the agent's proposal
   * list (S27 §13): a detected problem whose recommendation has an action
   * proposal surfaces it as an executable governed proposal. The engine's
   * provider already bounded it to the agent's capability set — this merge
   * only makes it reachable through the SAME proposal-execution path.
   */
  #mergeProblemProposals(
    proposals: readonly ActionProposal[],
    problems: readonly BusinessProblemDto[],
  ): readonly ActionProposal[] {
    const problemProposals = problems.flatMap((problem) => {
      const proposal = problem.recommendation?.actionProposal;
      return proposal === undefined ? [] : [proposal];
    });
    // Stable order: existing proposals first, then problem-derived ones
    // (each with its problem id so duplicates from re-scans collapse).
    const merged = [...proposals];
    const seen = new Set(merged.map((p) => p.id));
    for (const proposal of problemProposals) {
      if (!seen.has(proposal.id)) {
        merged.push(proposal);
        seen.add(proposal.id);
      }
    }
    return merged;
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
      // Problem-derived proposals merge into the executable set (S27 §13) so
      // a detected problem's remediation flows through the SAME governed
      // execution path — with the same capability-bound validation.
      const problems = await this.#loadProblems(context, agent);
      const proposal = this.#mergeProblemProposals(proposals, problems).find(
        (p) => p.id === request.proposalId,
      );
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

/** Handles resolving ONLY the agent's registered capability set. */
export class GetBusinessAgentCapabilitiesHandler {
  readonly #service: BusinessAgentApplicationService;

  constructor(service: BusinessAgentApplicationService) {
    this.#service = service;
  }

  handle(context: BusinessAgentContext): Promise<ResolveAgentCapabilitiesResult> {
    return this.#service.resolveCapabilities(context);
  }
}

/** Handles resolving ONLY the agent definition (identity + capability bound). */
export class GetBusinessAgentDefinitionHandler {
  readonly #service: BusinessAgentApplicationService;

  constructor(service: BusinessAgentApplicationService) {
    this.#service = service;
  }

  handle(context: BusinessAgentContext): Promise<ResolveBusinessAgentDefinitionResult> {
    return this.#service.resolveDefinition(context);
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

/** Composes the typed agent DTO (definition + proposals + runs + problems + context names). */
function toBusinessAgentDto(
  def: BusinessAgentDefinition,
  proposals: readonly ActionProposal[],
  recentRuns: readonly AgentExecutionRecord[],
  problems: readonly BusinessProblemDto[],
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
    problems,
  };
}
