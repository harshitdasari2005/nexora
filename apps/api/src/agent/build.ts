/**
 * @nexora/app-api — business-agent composition (S26 Phase 8).
 *
 * Wires the generic BusinessAgent engine with the API-layer
 * implementations: the Phase 1 domain catalog + initial agent definitions
 * (Executive / Manager / Developer) feed the registry, the SAME
 * MembershipBusinessRoleResolver the Command Center and AI Runtime use
 * derives the effective business role from trusted membership, the proposal
 * provider derives governed {@link ActionProposal}s through the EXISTING
 * application handlers (measurements, activity, notifications, projects) —
 * never fabricated data, never a second data-access layer — and the
 * execution port runs capability-bound intents through the EXISTING
 * Enterprise AI Orchestrator (one execution engine). Outcomes are journaled
 * through the durable agent-execution recorder (measurements).
 *
 * Pure composition: the engine is unchanged; a future agent is one more
 * registration in the seed.
 */

import type { AIBusinessContext, EnterpriseAIOrchestrator } from '@nexora/ai-runtime';
import type { MembershipRepository } from '@nexora/domain-organizations';
import type { WorkspaceMembershipRepository, WorkspaceRepository } from '@nexora/domain-workspaces';
import type { GetTenantMeasurementsHandler } from '@nexora/module-measurements';
import type { ListProjectsHandler } from '@nexora/application-projects';
import type { ListActivityHandler, ListNotificationsHandler } from '@nexora/module-notifications';
import { createInitialCatalog } from '@nexora/module-domains';
import {
  BusinessAgentApplicationService,
  BusinessAgentRegistry,
  ExecuteBusinessAgentHandler,
  GetBusinessAgentCapabilitiesHandler,
  GetBusinessAgentDefinitionHandler,
  GetBusinessAgentHandler,
  INITIAL_AGENTS,
  type AgentExecutionRecorder,
  type AgentPrincipalResolver,
  type AgentProblemProvider,
} from '@nexora/module-agents';

import { MembershipBusinessRoleResolver } from '../business-context/business-role-resolver.js';
import { ApiAgentExecutionPort } from './execution-port.js';
import { ApiAgentProposalProvider } from './proposal-provider.js';

/** Everything the API layer needs to compose the agent surface. */
export interface BuildAgentOptions {
  /** Organization memberships (role resolution fallback scope). */
  memberships: MembershipRepository;
  /** Workspace memberships (role resolution preferred scope). */
  workspaceMemberships: WorkspaceMembershipRepository;
  /** Workspaces (role resolution workspace-type override, S27 Phase 6). */
  workspaces: WorkspaceRepository;
  /** Tenant measurement snapshot handler (workflow health + overview signals). */
  getTenantMeasurements: GetTenantMeasurementsHandler;
  /** Tenant-scoped project listing handler. */
  listProjects: ListProjectsHandler;
  /** Tenant/workspace-scoped activity feed handler. */
  listActivity: ListActivityHandler;
  /** Recipient-scoped notification inbox handler. */
  listNotifications: ListNotificationsHandler;
  /** The EXISTING Enterprise AI Orchestrator (the one execution engine). */
  orchestrator: EnterpriseAIOrchestrator;
  /** Builds the TRUSTED business context from membership + the Phase 1 catalog. */
  buildBusinessContext: (context: {
    userId: string;
    tenantId: string;
    workspaceId?: string;
  }) => Promise<AIBusinessContext | undefined>;
  /** The durable execution journal (measurements); absent in hermetic tests. */
  executionRecorder?: AgentExecutionRecorder;
  /**
   * The proactive problem provider (S27): detected problems surface in the
   * agent DTO and their action proposals flow through the same governed
   * execution path. Absent when the detection surface is not wired.
   */
  problems?: AgentProblemProvider;
  /**
   * The ONE agent-definition registry (Prompt 4) — shared with delegation
   * management and the execution-time authority check. Built from the
   * initial definitions when absent.
   */
  registry?: BusinessAgentRegistry;
  /** Resolves persisted agent principals (Prompt 4); execution fails closed without it. */
  principals?: AgentPrincipalResolver;
}

/** The composed business-agent surface (query + execution + capabilities). */
export interface AgentSurface {
  /** The business-agent query handler (GET /api/agent). */
  getAgent: GetBusinessAgentHandler;
  /** The governed execution handler (POST /api/agent/…/execute). */
  executeAgent: ExecuteBusinessAgentHandler;
  /**
   * Resolves ONLY the caller's registered capability set — no DTO side
   * effects (no proposal derivation, no problem-provider scan). Consumed by
   * surfaces that must bound capabilities without re-evaluating detection
   * signals (S27 problems console).
   */
  getCapabilities: GetBusinessAgentCapabilitiesHandler;
  /**
   * Resolves ONLY the caller's agent definition (id/role/domain/capability
   * set) — no DTO side effects. Consumed by the Phase 10 remediation engine
   * to derive the plan's executing agent and bound its steps.
   */
  getDefinition: GetBusinessAgentDefinitionHandler;
}

/** Builds the business-agent surface (generic engine + API implementations). */
export function buildAgent(options: BuildAgentOptions): AgentSurface {
  const catalog = createInitialCatalog();
  const registry = options.registry ?? new BusinessAgentRegistry(catalog);
  if (options.registry === undefined) {
    for (const definition of INITIAL_AGENTS) {
      registry.register(definition);
    }
  }
  const service = new BusinessAgentApplicationService({
    registry,
    catalog,
    // The SAME trusted role-resolution seam the Command Center and AI
    // Runtime use: the agent can never disagree with them about the role.
    roleResolver: new MembershipBusinessRoleResolver({
      memberships: options.memberships,
      workspaceMemberships: options.workspaceMemberships,
      workspaces: options.workspaces,
    }),
    proposalProvider: new ApiAgentProposalProvider({
      getTenantMeasurements: options.getTenantMeasurements,
      listProjects: options.listProjects,
      listActivity: options.listActivity,
      listNotifications: options.listNotifications,
    }),
    // S34 RBAC: binds the agent's own registered capability set to
    // intersection(agent set, caller's REAL RBAC permission) — reuses the
    // SAME business-context builder passed in above (already resolves
    // trusted role → Phase 1 catalog → executable capability ids); never a
    // second resolution path.
    permissionResolver: {
      resolve: async (context) => {
        const business = await options.buildBusinessContext(context);
        return business?.capabilityIds;
      },
    },
    // Governed execution through the EXISTING runtime — never a second
    // execution engine or approval system.
    execution: new ApiAgentExecutionPort({
      orchestrator: options.orchestrator,
      buildBusinessContext: options.buildBusinessContext,
    }),
    recorder: options.executionRecorder,
    problems: options.problems,
    ...(options.principals === undefined ? {} : { principals: options.principals }),
  });
  return {
    getAgent: new GetBusinessAgentHandler(service),
    executeAgent: new ExecuteBusinessAgentHandler(service),
    getCapabilities: new GetBusinessAgentCapabilitiesHandler(service),
    getDefinition: new GetBusinessAgentDefinitionHandler(service),
  };
}
