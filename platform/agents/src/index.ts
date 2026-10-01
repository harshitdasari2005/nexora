/**
 * @nexora/module-agents — public surface.
 *
 * The governed business-agent engine (S26 Phase 8): role-resolved agent
 * definitions with goals, autonomy bounds, and governed action proposals —
 * resolved from the Phase 1 Domain → Role model and rendered by ONE engine.
 * This barrel is the only import surface — consumers never reach into
 * subfolders.
 *
 * Security contract (S26): definitions grant nothing. The effective
 * business role is resolved by the {@link BusinessAgentRoleResolver}
 * implementation from trusted membership, proposals are derived from real
 * persisted data through the existing application services, and every
 * execution continues through the existing AI Runtime/ToolExecutor/
 * ApprovalEngine — an agent can never self-grant capabilities or bypass
 * governance. The engine fails safely when a role has no agent registered.
 */

export {
  AgentError,
  DuplicateAgentError,
  InvalidAgentError,
  UnknownRoleReferenceError,
  toAgentError,
} from './errors.js';
export {
  BusinessAgentApplicationService,
  ExecuteBusinessAgentHandler,
  GetBusinessAgentCapabilitiesHandler,
  GetBusinessAgentDefinitionHandler,
  GetBusinessAgentHandler,
  type AgentPermissionResolver,
  type AgentProblemProvider,
  type AgentPrincipalResolver,
  type AgentProposalProvider,
  type BusinessAgentContext,
  type BusinessAgentDomainCatalogPort,
  type BusinessAgentRoleResolver,
  type ExecuteBusinessAgentRequest,
  type ExecuteBusinessAgentResult,
  type ResolveAgentCapabilitiesResult,
  type ResolveBusinessAgentDefinitionResult,
  type ResolveBusinessAgentResult,
} from './application/business-agent-application-service.js';
export type {
  AgentExecutionPort,
  AgentExecutionRecorder,
} from './application/agent-execution-port.js';
export { BusinessAgentRegistry } from './registry/business-agent-registry.js';
export { INITIAL_AGENTS } from './seed/initial-agents.js';
export {
  validateAgentDefinition,
  type AgentCatalogForValidation,
} from './validation/definitions.js';
export {
  NON_DELEGABLE_CAPABILITIES,
  delegationEffectiveStatus,
  effectiveAgentCapabilities,
  evaluateAgentAuthority,
  scopeCovers,
  type AgentAuthorityDecision,
  type AgentAuthorityDenial,
  type AgentAuthorityInput,
  type InvocationResources,
} from './identity/authority.js';
export {
  InMemoryAgentDelegationRepository,
  InMemoryAgentIdentityRepository,
  type AgentDelegationRepository,
  type AgentIdentityRepository,
} from './identity/repositories.js';
export {
  AgentIdentityService,
  MAX_DELEGATION_DAYS,
  RESOURCE_SCOPED_CAPABILITIES,
  type AgentAuthorityView,
  type AgentCapabilityResolver,
  type AgentDelegationView,
  type AgentIdentityServiceDependencies,
  type AgentManagementActor,
  type AgentManagementError,
  type AgentManagementFailure,
  type AgentResourceVerifier,
} from './identity/agent-identity-service.js';
