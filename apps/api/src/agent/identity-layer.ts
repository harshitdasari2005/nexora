/**
 * @nexora/app-api — the agent identity layer composition (Prompt 4).
 *
 * ONE composition of the agent identity stack, shared by the HTTP app and
 * the stdio MCP entry: repositories, the definition registry, the authority
 * clock, the execution-time authority adapter (wired into every
 * ToolExecutor), the management service, and the session-binding resolver.
 * One set of rules — never a second authorization system per surface.
 */

import type { EventPublisher } from '@nexora/shared/events';
import {
  AgentIdentityService,
  BusinessAgentRegistry,
  INITIAL_AGENTS,
  InMemoryAgentDelegationRepository,
  InMemoryAgentIdentityRepository,
  type AgentDelegationRepository,
  type AgentIdentityRepository,
} from '@nexora/module-agents';
import type { DomainCatalog } from '@nexora/module-domains';

import type { Container, RepositorySet } from '../container.js';
import { buildAIBusinessContext } from '../business-context/index.js';
import type { PermissionResolverDependencies } from '../business-context/permissions.js';
import { ApiAgentAuthority } from './agent-authority.js';
import { createAgentSessionResolver } from './agent-session.js';
import { createAgentResourceVerifier, createInvocationResourceResolver } from './resource-scope.js';

/** The composed agent identity layer. */
export interface AgentIdentityLayer {
  stores: { agents: AgentIdentityRepository; delegations: AgentDelegationRepository };
  definitions: BusinessAgentRegistry;
  clock: () => Date;
  capabilitiesOf: (input: {
    userId: string;
    organizationId: string;
    workspaceId: string;
  }) => Promise<readonly string[]>;
  authority: ApiAgentAuthority;
  identities: AgentIdentityService;
  resolveSession: ReturnType<typeof createAgentSessionResolver>;
}

/** Builds the agent identity layer (see module docs). */
export function buildAgentIdentityLayer(input: {
  repositories: RepositorySet;
  container: Pick<Container, 'findProjectByName'>;
  rbac: PermissionResolverDependencies & { catalog: DomainCatalog };
  publisher: EventPublisher;
  clock?: () => Date;
}): AgentIdentityLayer {
  const stores = {
    agents: input.repositories.agents ?? new InMemoryAgentIdentityRepository(),
    delegations: input.repositories.agentDelegations ?? new InMemoryAgentDelegationRepository(),
  };
  const clock = input.clock ?? (() => new Date());
  const definitions = new BusinessAgentRegistry(input.rbac.catalog);
  for (const definition of INITIAL_AGENTS) {
    definitions.register(definition);
  }
  const capabilitiesOf = async (query: {
    userId: string;
    organizationId: string;
    workspaceId: string;
  }): Promise<readonly string[]> =>
    (
      await buildAIBusinessContext(input.rbac, {
        userId: query.userId,
        tenantId: query.organizationId,
        workspaceId: query.workspaceId,
      })
    )?.capabilityIds ?? [];
  const scope = {
    findProjectByName: input.container.findProjectByName,
    repositories: input.repositories,
  };
  const authority = new ApiAgentAuthority({
    agents: stores.agents,
    delegations: stores.delegations,
    definitions,
    capabilitiesOf,
    resolveResources: createInvocationResourceResolver(scope),
    now: clock,
  });
  const identities = new AgentIdentityService({
    agents: stores.agents,
    delegations: stores.delegations,
    definitions,
    verifyResource: createAgentResourceVerifier(scope),
    capabilitiesOf,
    publisher: input.publisher,
    now: clock,
  });
  const resolveSession = createAgentSessionResolver({
    agents: stores.agents,
    identities,
    permissions: input.rbac,
  });
  return { stores, definitions, clock, capabilitiesOf, authority, identities, resolveSession };
}
