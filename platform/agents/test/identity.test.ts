/**
 * @nexora/module-agents — agent identity + authority tests (Prompt 4).
 *
 * Covers the pure authority evaluator (`evaluateAgentAuthority`, every
 * denial code, allow cases, `scopeCovers`, `delegationEffectiveStatus`,
 * `effectiveAgentCapabilities`) and the `AgentIdentityService` management
 * surface (create / grant / revoke / status) over the in-memory
 * repositories, a recording publisher, and a controllable clock. Every
 * denial is paired with a positive control so no test passes vacuously.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import type { AgentDelegation, AgentPrincipal, AgentResourceScope } from '@nexora/contracts/agent';
import type { EventEnvelope, EventPublisher } from '@nexora/shared/events';
import { createInitialCatalog } from '@nexora/module-domains';

import {
  AgentIdentityService,
  BusinessAgentRegistry,
  INITIAL_AGENTS,
  InMemoryAgentDelegationRepository,
  InMemoryAgentIdentityRepository,
  MAX_DELEGATION_DAYS,
  NON_DELEGABLE_CAPABILITIES,
  delegationEffectiveStatus,
  effectiveAgentCapabilities,
  evaluateAgentAuthority,
  scopeCovers,
  type AgentAuthorityInput,
  type AgentManagementActor,
  type InvocationResources,
} from '../src/index.js';

const registry = new BusinessAgentRegistry(createInitialCatalog());
for (const definition of INITIAL_AGENTS) {
  registry.register(definition);
}
const MANAGER_CAPS = registry.get('manager')?.capabilityIds ?? [];

const ORG = 'org_acme';
const WSP = 'wsp_eng';
const T0 = new Date('2026-06-01T00:00:00.000Z');
const DAY = 24 * 60 * 60 * 1000;

const AGENT: AgentPrincipal = {
  id: 'agt_mgr',
  organizationId: ORG,
  workspaceId: WSP,
  definitionId: 'manager',
  name: 'Manager Agent',
  description: 'test',
  status: 'active',
  ownerUserId: 'usr_alice',
  createdBy: 'usr_alice',
  createdAt: T0.toISOString(),
  updatedAt: T0.toISOString(),
};

function delegation(overrides: Partial<AgentDelegation> = {}): AgentDelegation {
  return {
    id: 'dlg_1',
    agentId: AGENT.id,
    organizationId: ORG,
    workspaceId: WSP,
    grantedByUserId: 'usr_alice',
    capabilityId: 'projects.find_project',
    status: 'active',
    createdAt: T0.toISOString(),
    ...overrides,
  };
}

const NO_RESOURCES: InvocationResources = { kind: 'resolved', resources: [] };
const P123: AgentResourceScope = { kind: 'project', id: 'prj_123' };
const P456: AgentResourceScope = { kind: 'project', id: 'prj_456' };

/** A fully authorized input; each test perturbs one factor. */
function input(overrides: Partial<AgentAuthorityInput> = {}): AgentAuthorityInput {
  return {
    agent: AGENT,
    run: { organizationId: ORG, workspaceId: WSP, initiatingUserId: 'usr_alice' },
    capabilityId: 'projects.find_project',
    resources: NO_RESOURCES,
    delegations: [delegation()],
    definitionCapabilityIds: MANAGER_CAPS,
    initiatorCapabilityIds: MANAGER_CAPS,
    grantorCapabilityIds: () => MANAGER_CAPS,
    now: T0,
    ...overrides,
  };
}

function denialOf(overrides: Partial<AgentAuthorityInput>): string | undefined {
  const decision = evaluateAgentAuthority(input(overrides));
  return decision.ok ? undefined : decision.denial;
}

describe('fixture sanity (guards against vacuous tests)', () => {
  it('the manager ceiling holds the capabilities used as positives and excludes the negatives', () => {
    for (const cap of [
      'projects.find_project',
      'knowledge.search',
      'hr.find_employee',
      'github.issues.list',
    ]) {
      expect(MANAGER_CAPS).toContain(cap);
    }
    for (const cap of ['finance.submit_expense', 'approvals.decide', 'agents.manage']) {
      expect(MANAGER_CAPS).not.toContain(cap);
    }
  });
});

describe('evaluateAgentAuthority', () => {
  it('positive control: the baseline input is allowed', () => {
    const decision = evaluateAgentAuthority(input());
    expect(decision.ok).toBe(true);
    if (decision.ok) expect(decision.delegation.id).toBe('dlg_1');
  });

  it('AGENT_NOT_FOUND when the agent is missing', () => {
    expect(denialOf({ agent: undefined })).toBe('AGENT_NOT_FOUND');
  });

  it('AGENT_SUSPENDED / AGENT_REVOKED by status', () => {
    expect(denialOf({ agent: { ...AGENT, status: 'suspended' } })).toBe('AGENT_SUSPENDED');
    expect(denialOf({ agent: { ...AGENT, status: 'revoked' } })).toBe('AGENT_REVOKED');
    expect(denialOf({ agent: { ...AGENT, status: 'active' } })).toBeUndefined();
  });

  it('AGENT_OUT_OF_SCOPE for another organization and another workspace', () => {
    expect(
      denialOf({ run: { organizationId: 'org_other', workspaceId: WSP, initiatingUserId: 'u' } }),
    ).toBe('AGENT_OUT_OF_SCOPE');
    expect(
      denialOf({ run: { organizationId: ORG, workspaceId: 'wsp_other', initiatingUserId: 'u' } }),
    ).toBe('AGENT_OUT_OF_SCOPE');
    expect(denialOf({ run: { organizationId: ORG, initiatingUserId: 'u' } })).toBe(
      'AGENT_OUT_OF_SCOPE',
    );
    expect(
      denialOf({ run: { organizationId: ORG, workspaceId: WSP, initiatingUserId: 'u' } }),
    ).toBeUndefined();
  });

  it('CAPABILITY_NOT_DELEGABLE for approvals.decide even with a grant, ceiling and user authority', () => {
    const caps = [...MANAGER_CAPS, 'approvals.decide'];
    expect(
      denialOf({
        capabilityId: 'approvals.decide',
        definitionCapabilityIds: caps,
        initiatorCapabilityIds: caps,
        grantorCapabilityIds: () => caps,
        delegations: [delegation({ capabilityId: 'approvals.decide' })],
      }),
    ).toBe('CAPABILITY_NOT_DELEGABLE');
  });

  it('policy administration capabilities are on the non-delegable list', () => {
    expect(NON_DELEGABLE_CAPABILITIES).toEqual(
      expect.arrayContaining(['policy.read', 'policy.manage']),
    );
  });

  it('CAPABILITY_NOT_DELEGABLE for every human-only capability', () => {
    for (const cap of [
      'approvals.decide',
      'agents.manage',
      'agents.delegate',
      'audit.read',
      'policy.read',
      'policy.manage',
    ]) {
      const caps = [...MANAGER_CAPS, cap];
      expect(
        denialOf({
          capabilityId: cap,
          definitionCapabilityIds: caps,
          initiatorCapabilityIds: caps,
          grantorCapabilityIds: () => caps,
          delegations: [delegation({ capabilityId: cap })],
        }),
      ).toBe('CAPABILITY_NOT_DELEGABLE');
    }
  });

  it('CAPABILITY_OUTSIDE_AGENT_DEFINITION (outside ceiling, or unknown definition)', () => {
    const caps = [...MANAGER_CAPS, 'finance.submit_expense'];
    expect(
      denialOf({
        capabilityId: 'finance.submit_expense',
        initiatorCapabilityIds: caps,
        grantorCapabilityIds: () => caps,
        delegations: [delegation({ capabilityId: 'finance.submit_expense' })],
      }),
    ).toBe('CAPABILITY_OUTSIDE_AGENT_DEFINITION');
    expect(denialOf({ definitionCapabilityIds: undefined })).toBe(
      'CAPABILITY_OUTSIDE_AGENT_DEFINITION',
    );
  });

  it('INITIATOR_LACKS_CAPABILITY when the initiating user does not hold it now', () => {
    expect(denialOf({ initiatorCapabilityIds: ['knowledge.search'] })).toBe(
      'INITIATOR_LACKS_CAPABILITY',
    );
  });

  it('DELEGATION_MISSING when the agent has no grants at all', () => {
    expect(denialOf({ delegations: [] })).toBe('DELEGATION_MISSING');
    // Grants belonging to ANOTHER agent do not count.
    expect(denialOf({ delegations: [delegation({ agentId: 'agt_other' })] })).toBe(
      'DELEGATION_MISSING',
    );
  });

  it('CAPABILITY_OUTSIDE_DELEGATION when grants exist only for other capabilities', () => {
    expect(denialOf({ delegations: [delegation({ capabilityId: 'knowledge.search' })] })).toBe(
      'CAPABILITY_OUTSIDE_DELEGATION',
    );
    expect(
      denialOf({
        capabilityId: 'knowledge.search',
        delegations: [delegation({ capabilityId: 'knowledge.search' })],
      }),
    ).toBeUndefined();
  });

  it('a grant bound to another org/workspace never counts for this agent', () => {
    expect(denialOf({ delegations: [delegation({ workspaceId: 'wsp_other' })] })).toBe(
      'CAPABILITY_OUTSIDE_DELEGATION',
    );
    expect(denialOf({ delegations: [delegation({ organizationId: 'org_other' })] })).toBe(
      'CAPABILITY_OUTSIDE_DELEGATION',
    );
  });

  it('DELEGATION_REVOKED when the only matching grant is revoked', () => {
    expect(denialOf({ delegations: [delegation({ status: 'revoked' })] })).toBe(
      'DELEGATION_REVOKED',
    );
  });

  it('DELEGATION_EXPIRED at the exact expiry instant and after; allowed 1ms before', () => {
    const expiresAt = new Date(T0.getTime() + DAY).toISOString();
    const delegations = [delegation({ expiresAt })];
    expect(denialOf({ delegations, now: new Date(T0.getTime() + DAY) })).toBe('DELEGATION_EXPIRED');
    expect(denialOf({ delegations, now: new Date(T0.getTime() + 2 * DAY) })).toBe(
      'DELEGATION_EXPIRED',
    );
    expect(denialOf({ delegations, now: new Date(T0.getTime() + DAY - 1) })).toBeUndefined();
  });

  it('DELEGATION_GRANTOR_LACKS_CAPABILITY when the grantor lost the capability', () => {
    expect(denialOf({ grantorCapabilityIds: () => ['knowledge.search'] })).toBe(
      'DELEGATION_GRANTOR_LACKS_CAPABILITY',
    );
    // Only THIS grantor's authority matters.
    expect(
      denialOf({
        grantorCapabilityIds: (userId) => (userId === 'usr_alice' ? MANAGER_CAPS : []),
      }),
    ).toBeUndefined();
  });

  describe('DELEGATION_RESOURCE_OUT_OF_SCOPE', () => {
    const scoped = [delegation({ resourceScope: P123 })];

    it('allows the scoped grant on its own resource (positive control)', () => {
      expect(
        denialOf({ delegations: scoped, resources: { kind: 'resolved', resources: [P123] } }),
      ).toBeUndefined();
    });

    it('denies a different project', () => {
      expect(
        denialOf({ delegations: scoped, resources: { kind: 'resolved', resources: [P456] } }),
      ).toBe('DELEGATION_RESOURCE_OUT_OF_SCOPE');
    });

    it('denies an invocation that touches both projects (ambiguous)', () => {
      expect(
        denialOf({
          delegations: scoped,
          resources: { kind: 'resolved', resources: [P123, P456] },
        }),
      ).toBe('DELEGATION_RESOURCE_OUT_OF_SCOPE');
    });

    it('denies unresolvable resources and reports the reason', () => {
      const decision = evaluateAgentAuthority(
        input({ delegations: scoped, resources: { kind: 'unresolvable', reason: 'ambiguous' } }),
      );
      expect(decision.ok).toBe(false);
      if (!decision.ok) {
        expect(decision.denial).toBe('DELEGATION_RESOURCE_OUT_OF_SCOPE');
        expect(decision.reason).toContain('ambiguous');
      }
    });

    it('denies an invocation that touches no project for a project-scoped grant', () => {
      expect(denialOf({ delegations: scoped, resources: NO_RESOURCES })).toBe(
        'DELEGATION_RESOURCE_OUT_OF_SCOPE',
      );
    });
  });

  describe('allow cases', () => {
    it('a workspace-wide grant covers any resource, even unresolvable', () => {
      expect(denialOf({ resources: { kind: 'resolved', resources: [P123, P456] } })).toBe(
        undefined,
      );
      expect(denialOf({ resources: { kind: 'unresolvable', reason: 'x' } })).toBeUndefined();
    });

    it('selects the active grant when a revoked one also matches', () => {
      const decision = evaluateAgentAuthority(
        input({
          delegations: [
            delegation({ id: 'dlg_a', status: 'revoked', resourceScope: P123 }),
            delegation({ id: 'dlg_b', resourceScope: P123 }),
          ],
          resources: { kind: 'resolved', resources: [P123] },
        }),
      );
      expect(decision.ok).toBe(true);
      if (decision.ok) expect(decision.delegation.id).toBe('dlg_b');
    });

    it('picks the scoped grant covering the resource among several', () => {
      const decision = evaluateAgentAuthority(
        input({
          delegations: [
            delegation({ id: 'dlg_a', resourceScope: P456 }),
            delegation({ id: 'dlg_b', resourceScope: P123 }),
          ],
          resources: { kind: 'resolved', resources: [P123] },
        }),
      );
      expect(decision.ok).toBe(true);
      if (decision.ok) expect(decision.delegation.id).toBe('dlg_b');
    });

    it('reports the most specific reason: scope mismatch beats revoked/expired', () => {
      expect(
        denialOf({
          delegations: [
            delegation({ id: 'dlg_a', status: 'revoked' }),
            delegation({ id: 'dlg_b', expiresAt: T0.toISOString() }),
            delegation({ id: 'dlg_c', resourceScope: P456 }),
          ],
          resources: { kind: 'resolved', resources: [P123] },
        }),
      ).toBe('DELEGATION_RESOURCE_OUT_OF_SCOPE');
      expect(
        denialOf({
          delegations: [
            delegation({ id: 'dlg_a', status: 'revoked' }),
            delegation({ id: 'dlg_b', expiresAt: T0.toISOString() }),
          ],
        }),
      ).toBe('DELEGATION_EXPIRED');
      // Grantor loss is reported ahead of expiry/revocation.
      expect(
        denialOf({
          delegations: [
            delegation({ id: 'dlg_a', status: 'revoked' }),
            delegation({ id: 'dlg_b', expiresAt: T0.toISOString() }),
            delegation({ id: 'dlg_c', grantedByUserId: 'usr_gone' }),
          ],
          grantorCapabilityIds: (userId) => (userId === 'usr_gone' ? [] : MANAGER_CAPS),
        }),
      ).toBe('DELEGATION_GRANTOR_LACKS_CAPABILITY');
    });

    it('selects the active grant when an expired one also matches', () => {
      const decision = evaluateAgentAuthority(
        input({
          delegations: [
            delegation({ id: 'dlg_a', expiresAt: T0.toISOString() }),
            delegation({ id: 'dlg_b' }),
          ],
        }),
      );
      expect(decision.ok).toBe(true);
      if (decision.ok) expect(decision.delegation.id).toBe('dlg_b');
    });

    it("falls through to another grantor's grant when one grantor lost the capability", () => {
      const decision = evaluateAgentAuthority(
        input({
          delegations: [
            delegation({ id: 'dlg_a', grantedByUserId: 'usr_gone' }),
            delegation({ id: 'dlg_b', grantedByUserId: 'usr_alice' }),
          ],
          grantorCapabilityIds: (userId) => (userId === 'usr_gone' ? [] : MANAGER_CAPS),
        }),
      );
      expect(decision.ok).toBe(true);
      if (decision.ok) expect(decision.delegation.id).toBe('dlg_b');
    });
  });
});

describe('scopeCovers', () => {
  it('undefined scope covers everything', () => {
    expect(scopeCovers(undefined, NO_RESOURCES)).toBe(true);
    expect(scopeCovers(undefined, { kind: 'unresolvable', reason: 'x' })).toBe(true);
  });

  it('a scoped grant needs positive proof', () => {
    expect(scopeCovers(P123, { kind: 'unresolvable', reason: 'x' })).toBe(false);
    expect(scopeCovers(P123, NO_RESOURCES)).toBe(false);
    expect(scopeCovers(P123, { kind: 'resolved', resources: [P123] })).toBe(true);
    expect(scopeCovers(P123, { kind: 'resolved', resources: [P123, P123] })).toBe(true);
    expect(scopeCovers(P123, { kind: 'resolved', resources: [P456] })).toBe(false);
    expect(scopeCovers(P123, { kind: 'resolved', resources: [P123, P456] })).toBe(false);
  });

  it('ignores resources of other kinds but still needs one of the scoped kind', () => {
    const budget: AgentResourceScope = { kind: 'budget', id: 'bdg_1' };
    expect(scopeCovers(P123, { kind: 'resolved', resources: [P123, budget] })).toBe(true);
    expect(scopeCovers(P123, { kind: 'resolved', resources: [budget] })).toBe(false);
    // Same id, different kind does not match.
    expect(
      scopeCovers(P123, { kind: 'resolved', resources: [{ kind: 'budget', id: 'prj_123' }] }),
    ).toBe(false);
  });
});

describe('delegationEffectiveStatus', () => {
  it('active without expiry; revoked wins over expiry', () => {
    expect(delegationEffectiveStatus(delegation(), T0)).toBe('active');
    expect(
      delegationEffectiveStatus(
        delegation({ status: 'revoked', expiresAt: new Date(T0.getTime() - DAY).toISOString() }),
        T0,
      ),
    ).toBe('revoked');
  });

  it('expired exactly at expiresAt, active 1ms before', () => {
    const d = delegation({ expiresAt: T0.toISOString() });
    expect(delegationEffectiveStatus(d, T0)).toBe('expired');
    expect(delegationEffectiveStatus(d, new Date(T0.getTime() - 1))).toBe('active');
    expect(delegationEffectiveStatus(d, new Date(T0.getTime() + 1))).toBe('expired');
  });
});

describe('effectiveAgentCapabilities', () => {
  const base = (): Omit<AgentAuthorityInput, 'capabilityId' | 'resources'> => {
    const full: Partial<AgentAuthorityInput> = input();
    delete full.capabilityId;
    delete full.resources;
    return full as Omit<AgentAuthorityInput, 'capabilityId' | 'resources'>;
  };

  it('is the sorted set of capabilities with a usable grant (scoped grants count)', () => {
    const result = effectiveAgentCapabilities({
      ...base(),
      delegations: [
        delegation({ id: 'dlg_1', capabilityId: 'knowledge.search' }),
        delegation({ id: 'dlg_2', capabilityId: 'projects.find_project', resourceScope: P123 }),
        delegation({ id: 'dlg_3', capabilityId: 'hr.find_employee', status: 'revoked' }),
        delegation({
          id: 'dlg_4',
          capabilityId: 'github.issues.list',
          expiresAt: T0.toISOString(),
        }),
        delegation({ id: 'dlg_5', capabilityId: 'finance.submit_expense' }),
        delegation({ id: 'dlg_6', capabilityId: 'approvals.decide' }),
      ],
    });
    expect(result).toEqual(['knowledge.search', 'projects.find_project']);
  });

  it('is empty with no delegations, for an inactive agent, or when the grantor lost authority', () => {
    expect(effectiveAgentCapabilities({ ...base(), delegations: [] })).toEqual([]);
    expect(
      effectiveAgentCapabilities({ ...base(), agent: { ...AGENT, status: 'suspended' } }),
    ).toEqual([]);
    expect(effectiveAgentCapabilities({ ...base(), grantorCapabilityIds: () => [] })).toEqual([]);
    expect(effectiveAgentCapabilities(base())).toEqual(['projects.find_project']);
  });
});

// ---------------------------------------------------------------------------
// AgentIdentityService
// ---------------------------------------------------------------------------

class RecordingPublisher implements EventPublisher {
  readonly events: EventEnvelope[] = [];
  async publish(events: readonly EventEnvelope[]): Promise<void> {
    this.events.push(...events);
  }
  types(): string[] {
    return this.events.map((event) => event.type);
  }
}

interface Harness {
  service: AgentIdentityService;
  agents: InMemoryAgentIdentityRepository;
  delegations: InMemoryAgentDelegationRepository;
  publisher: RecordingPublisher;
  clock: { now: Date };
  verified: AgentResourceScope[];
  existing: Set<string>;
}

function harness(): Harness {
  const agents = new InMemoryAgentIdentityRepository();
  const delegations = new InMemoryAgentDelegationRepository();
  const publisher = new RecordingPublisher();
  const clock = { now: new Date(T0) };
  const verified: AgentResourceScope[] = [];
  const existing = new Set<string>(['project:prj_123']);
  const service = new AgentIdentityService({
    agents,
    delegations,
    definitions: registry,
    verifyResource: async (scope, organizationId, workspaceId) => {
      verified.push(scope);
      return (
        organizationId === ORG && workspaceId === WSP && existing.has(`${scope.kind}:${scope.id}`)
      );
    },
    capabilitiesOf: async () => MANAGER_CAPS,
    publisher,
    now: () => clock.now,
  });
  return { service, agents, delegations, publisher, clock, verified, existing };
}

const ALICE: AgentManagementActor = {
  userId: 'usr_alice',
  organizationId: ORG,
  workspaceId: WSP,
  capabilityIds: MANAGER_CAPS,
};

async function createManager(h: Harness, actor = ALICE): Promise<AgentPrincipal> {
  const created = await h.service.createAgent(actor, { definitionId: 'manager', name: 'Mgr' });
  if (!created.ok) throw new Error(created.failure);
  return created.agent;
}

describe('AgentIdentityService.createAgent', () => {
  it('creates an active agent that holds NOTHING and publishes agent.created', async () => {
    const h = harness();
    const agent = await createManager(h);
    expect(agent).toMatchObject({
      organizationId: ORG,
      workspaceId: WSP,
      definitionId: 'manager',
      status: 'active',
      ownerUserId: 'usr_alice',
      createdBy: 'usr_alice',
      createdAt: T0.toISOString(),
    });
    expect(h.agents.agents.get(agent.id)).toEqual(agent);
    expect(h.delegations.delegations.size).toBe(0);
    expect(h.publisher.types()).toEqual(['agent.created']);
    expect(h.publisher.events[0]?.payload).toMatchObject({ agentId: agent.id });

    const inspected = await h.service.inspectAgent(ALICE, agent.id);
    expect(inspected.ok).toBe(true);
    if (inspected.ok) {
      expect(inspected.view.effectiveCapabilityIds).toEqual([]);
      expect(inspected.view.delegations).toEqual([]);
      expect(inspected.view.definitionCapabilityIds).toEqual(MANAGER_CAPS);
    }
  });

  it('ownership grants no authority either', async () => {
    const h = harness();
    const created = await h.service.createAgent(ALICE, {
      definitionId: 'manager',
      name: 'Owned',
      ownerUserId: 'usr_bob',
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    expect(created.agent.ownerUserId).toBe('usr_bob');
    const inspected = await h.service.inspectAgent(ALICE, created.agent.id);
    expect(inspected.ok && inspected.view.effectiveCapabilityIds).toEqual([]);
  });

  it('refuses unknown definitions and bad names', async () => {
    const h = harness();
    const unknown = await h.service.createAgent(ALICE, { definitionId: 'nope', name: 'x' });
    expect(unknown.ok ? undefined : unknown.failure).toBe('UNKNOWN_DEFINITION');
    const blank = await h.service.createAgent(ALICE, { definitionId: 'manager', name: '  ' });
    expect(blank.ok ? undefined : blank.failure).toBe('INVALID_INPUT');
    expect(h.agents.agents.size).toBe(0);
    expect(h.publisher.events).toHaveLength(0);
  });
});

describe('AgentIdentityService.grantDelegation', () => {
  let h: Harness;
  let agent: AgentPrincipal;

  beforeEach(async () => {
    h = harness();
    agent = await createManager(h);
    h.publisher.events.length = 0;
  });

  async function expectRefused(
    actor: AgentManagementActor,
    agentId: string,
    body: Parameters<AgentIdentityService['grantDelegation']>[2],
    failure: string,
  ): Promise<void> {
    const result = await h.service.grantDelegation(actor, agentId, body);
    expect(result.ok ? 'ok' : result.failure).toBe(failure);
    expect(h.delegations.delegations.size).toBe(0);
    expect(h.publisher.events).toHaveLength(0);
  }

  it('positive control: a valid grant succeeds and persists exactly what was asked', async () => {
    const expiresAt = new Date(T0.getTime() + 7 * DAY).toISOString();
    const result = await h.service.grantDelegation(ALICE, agent.id, {
      capabilityId: 'projects.find_project',
      resourceScope: P123,
      expiresAt,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const stored = h.delegations.delegations.get(result.delegation.id);
    expect(stored).toEqual(result.delegation);
    expect(stored).toMatchObject({
      agentId: agent.id,
      organizationId: ORG,
      workspaceId: WSP,
      grantedByUserId: 'usr_alice',
      capabilityId: 'projects.find_project',
      resourceScope: P123,
      expiresAt,
      status: 'active',
      createdAt: T0.toISOString(),
    });
    expect(h.delegations.delegations.size).toBe(1);
    expect(h.publisher.types()).toEqual(['agent.delegation.granted']);
    expect(h.verified).toEqual([P123]);

    const inspected = await h.service.inspectAgent(ALICE, agent.id);
    expect(inspected.ok && inspected.view.effectiveCapabilityIds).toEqual([
      'projects.find_project',
    ]);
  });

  it('grantedByUserId is the actor, not the owner', async () => {
    const bob: AgentManagementActor = { ...ALICE, userId: 'usr_bob' };
    const result = await h.service.grantDelegation(bob, agent.id, {
      capabilityId: 'knowledge.search',
    });
    expect(result.ok && result.delegation.grantedByUserId).toBe('usr_bob');
    expect(result.ok && result.delegation.resourceScope).toBeUndefined();
    expect(result.ok && result.delegation.expiresAt).toBeUndefined();
  });

  it('AGENT_NOT_FOUND for an actor in another org or another workspace', async () => {
    await expectRefused(
      { ...ALICE, organizationId: 'org_other' },
      agent.id,
      { capabilityId: 'knowledge.search' },
      'AGENT_NOT_FOUND',
    );
    await expectRefused(
      { ...ALICE, workspaceId: 'wsp_other' },
      agent.id,
      { capabilityId: 'knowledge.search' },
      'AGENT_NOT_FOUND',
    );
    await expectRefused(
      ALICE,
      'agt_missing',
      { capabilityId: 'knowledge.search' },
      'AGENT_NOT_FOUND',
    );
  });

  it('AGENT_NOT_ACTIVE for a suspended agent, AGENT_REVOKED for a revoked one', async () => {
    await h.service.setAgentStatus(ALICE, agent.id, 'suspended');
    h.publisher.events.length = 0;
    await expectRefused(ALICE, agent.id, { capabilityId: 'knowledge.search' }, 'AGENT_NOT_ACTIVE');
    await h.service.setAgentStatus(ALICE, agent.id, 'revoked');
    h.publisher.events.length = 0;
    await expectRefused(ALICE, agent.id, { capabilityId: 'knowledge.search' }, 'AGENT_REVOKED');
  });

  it('CAPABILITY_NOT_DELEGABLE for approvals.decide even when the actor holds it', async () => {
    await expectRefused(
      { ...ALICE, capabilityIds: [...MANAGER_CAPS, 'approvals.decide'] },
      agent.id,
      { capabilityId: 'approvals.decide' },
      'CAPABILITY_NOT_DELEGABLE',
    );
  });

  it('CAPABILITY_OUTSIDE_AGENT_DEFINITION for a capability outside the manager ceiling', async () => {
    await expectRefused(
      { ...ALICE, capabilityIds: [...MANAGER_CAPS, 'finance.submit_expense'] },
      agent.id,
      { capabilityId: 'finance.submit_expense' },
      'CAPABILITY_OUTSIDE_AGENT_DEFINITION',
    );
  });

  it('DELEGATION_EXCEEDS_USER_AUTHORITY: refused, nothing persisted, never reduced', async () => {
    await expectRefused(
      { ...ALICE, capabilityIds: ['knowledge.search'] },
      agent.id,
      { capabilityId: 'projects.find_project', resourceScope: P123 },
      'DELEGATION_EXCEEDS_USER_AUTHORITY',
    );
    // Not silently reduced to some other capability the actor DOES hold.
    expect([...h.delegations.delegations.values()]).toEqual([]);
    const inspected = await h.service.inspectAgent(ALICE, agent.id);
    expect(inspected.ok && inspected.view.delegations).toEqual([]);
    expect(h.verified).toEqual([]);
    // Positive control: the same request from an actor holding the capability succeeds.
    const ok = await h.service.grantDelegation(ALICE, agent.id, {
      capabilityId: 'projects.find_project',
      resourceScope: P123,
    });
    expect(ok.ok && ok.delegation.capabilityId).toBe('projects.find_project');
    expect(h.delegations.delegations.size).toBe(1);
  });

  it('CAPABILITY_NOT_DELEGABLE for every human-only capability', async () => {
    for (const cap of [
      'approvals.decide',
      'agents.manage',
      'agents.delegate',
      'audit.read',
      'policy.read',
      'policy.manage',
    ]) {
      await expectRefused(
        { ...ALICE, capabilityIds: [...MANAGER_CAPS, cap] },
        agent.id,
        { capabilityId: cap },
        'CAPABILITY_NOT_DELEGABLE',
      );
    }
  });

  it('RESOURCE_SCOPE_UNSUPPORTED for a non-scopable capability or a wrong kind', async () => {
    await expectRefused(
      ALICE,
      agent.id,
      { capabilityId: 'knowledge.search', resourceScope: P123 },
      'RESOURCE_SCOPE_UNSUPPORTED',
    );
    await expectRefused(
      ALICE,
      agent.id,
      { capabilityId: 'projects.find_project', resourceScope: { kind: 'budget', id: 'bdg_1' } },
      'RESOURCE_SCOPE_UNSUPPORTED',
    );
  });

  it('RESOURCE_NOT_FOUND when the verifier returns false', async () => {
    await expectRefused(
      ALICE,
      agent.id,
      { capabilityId: 'projects.find_project', resourceScope: P456 },
      'RESOURCE_NOT_FOUND',
    );
    expect(h.verified).toEqual([P456]);
  });

  it('EXPIRY_INVALID for past, now, beyond 90 days, and garbage; exactly 90 days is allowed', async () => {
    const at = (ms: number): string => new Date(T0.getTime() + ms).toISOString();
    for (const expiresAt of [at(-DAY), at(0), at(MAX_DELEGATION_DAYS * DAY + 1), 'not-a-date']) {
      await expectRefused(
        ALICE,
        agent.id,
        { capabilityId: 'knowledge.search', expiresAt },
        'EXPIRY_INVALID',
      );
    }
    const edge = await h.service.grantDelegation(ALICE, agent.id, {
      capabilityId: 'knowledge.search',
      expiresAt: at(MAX_DELEGATION_DAYS * DAY),
    });
    expect(edge.ok && edge.delegation.expiresAt).toBe(at(MAX_DELEGATION_DAYS * DAY));
  });

  it('a granted delegation expires on the clock (derived, not stored)', async () => {
    const result = await h.service.grantDelegation(ALICE, agent.id, {
      capabilityId: 'knowledge.search',
      expiresAt: new Date(T0.getTime() + DAY).toISOString(),
    });
    expect(result.ok).toBe(true);
    h.clock.now = new Date(T0.getTime() + DAY);
    const inspected = await h.service.inspectAgent(ALICE, agent.id);
    expect(inspected.ok && inspected.view.effectiveCapabilityIds).toEqual([]);
    expect(inspected.ok && inspected.view.delegations[0]?.effectiveStatus).toBe('expired');
    expect(inspected.ok && inspected.view.delegations[0]?.status).toBe('active');
  });
});

describe('AgentIdentityService.revokeDelegation', () => {
  it('revokes once, is idempotent, keeps the record', async () => {
    const h = harness();
    const agent = await createManager(h);
    const granted = await h.service.grantDelegation(ALICE, agent.id, {
      capabilityId: 'knowledge.search',
    });
    if (!granted.ok) throw new Error(granted.failure);
    h.publisher.events.length = 0;
    h.clock.now = new Date(T0.getTime() + 1000);

    const bob: AgentManagementActor = { ...ALICE, userId: 'usr_bob' };
    const first = await h.service.revokeDelegation(bob, agent.id, granted.delegation.id, ' done ');
    expect(first.ok && first.changed).toBe(true);
    expect(h.publisher.types()).toEqual(['agent.delegation.revoked']);

    const second = await h.service.revokeDelegation(ALICE, agent.id, granted.delegation.id);
    expect(second.ok && second.changed).toBe(false);
    expect(h.publisher.events).toHaveLength(1);

    const stored = h.delegations.delegations.get(granted.delegation.id);
    expect(stored).toMatchObject({
      status: 'revoked',
      revokedAt: new Date(T0.getTime() + 1000).toISOString(),
      revokedBy: 'usr_bob',
      revokeReason: 'done',
      capabilityId: 'knowledge.search',
    });
    expect(h.delegations.delegations.size).toBe(1);
    const inspected = await h.service.inspectAgent(ALICE, agent.id);
    expect(inspected.ok && inspected.view.effectiveCapabilityIds).toEqual([]);
  });

  it('DELEGATION_NOT_FOUND for a delegation of a different agent (and it stays active)', async () => {
    const h = harness();
    const a = await createManager(h);
    const b = await createManager(h);
    const granted = await h.service.grantDelegation(ALICE, a.id, {
      capabilityId: 'knowledge.search',
    });
    if (!granted.ok) throw new Error(granted.failure);
    const wrong = await h.service.revokeDelegation(ALICE, b.id, granted.delegation.id);
    expect(wrong.ok ? 'ok' : wrong.failure).toBe('DELEGATION_NOT_FOUND');
    expect(h.delegations.delegations.get(granted.delegation.id)?.status).toBe('active');
    const missing = await h.service.revokeDelegation(ALICE, a.id, 'dlg_missing');
    expect(missing.ok ? 'ok' : missing.failure).toBe('DELEGATION_NOT_FOUND');
    // Positive control: the right agent revokes it.
    const right = await h.service.revokeDelegation(ALICE, a.id, granted.delegation.id);
    expect(right.ok && right.changed).toBe(true);
  });

  it('AGENT_NOT_FOUND from another workspace', async () => {
    const h = harness();
    const agent = await createManager(h);
    const granted = await h.service.grantDelegation(ALICE, agent.id, {
      capabilityId: 'knowledge.search',
    });
    if (!granted.ok) throw new Error(granted.failure);
    const result = await h.service.revokeDelegation(
      { ...ALICE, workspaceId: 'wsp_other' },
      agent.id,
      granted.delegation.id,
    );
    expect(result.ok ? 'ok' : result.failure).toBe('AGENT_NOT_FOUND');
    expect(h.delegations.delegations.get(granted.delegation.id)?.status).toBe('active');
  });
});

describe('AgentIdentityService.setAgentStatus', () => {
  it('suspend -> reactivate -> revoke; revoked is terminal; same status is idempotent', async () => {
    const h = harness();
    const agent = await createManager(h);
    h.publisher.events.length = 0;

    const suspended = await h.service.setAgentStatus(ALICE, agent.id, 'suspended', 'pause');
    expect(suspended.ok && suspended.changed).toBe(true);
    expect(suspended.ok && suspended.agent).toMatchObject({
      status: 'suspended',
      statusChangedBy: 'usr_alice',
      statusReason: 'pause',
    });

    const again = await h.service.setAgentStatus(ALICE, agent.id, 'suspended');
    expect(again.ok && again.changed).toBe(false);

    const reactivated = await h.service.setAgentStatus(ALICE, agent.id, 'active');
    expect(reactivated.ok && reactivated.changed).toBe(true);

    const revoked = await h.service.setAgentStatus(ALICE, agent.id, 'revoked');
    expect(revoked.ok && revoked.changed).toBe(true);

    const reactivate = await h.service.setAgentStatus(ALICE, agent.id, 'active');
    expect(reactivate.ok ? 'ok' : reactivate.failure).toBe('AGENT_REVOKED');
    const suspend = await h.service.setAgentStatus(ALICE, agent.id, 'suspended');
    expect(suspend.ok ? 'ok' : suspend.failure).toBe('AGENT_REVOKED');
    const revokeAgain = await h.service.setAgentStatus(ALICE, agent.id, 'revoked');
    expect(revokeAgain.ok && revokeAgain.changed).toBe(false);

    expect(h.publisher.types()).toEqual(['agent.suspended', 'agent.reactivated', 'agent.revoked']);
    expect(h.agents.agents.get(agent.id)?.status).toBe('revoked');
  });

  it('AGENT_NOT_FOUND from another org / workspace; status unchanged', async () => {
    const h = harness();
    const agent = await createManager(h);
    for (const actor of [
      { ...ALICE, organizationId: 'org_other' },
      { ...ALICE, workspaceId: 'wsp_other' },
    ]) {
      const result = await h.service.setAgentStatus(actor, agent.id, 'revoked');
      expect(result.ok ? 'ok' : result.failure).toBe('AGENT_NOT_FOUND');
    }
    expect(h.agents.agents.get(agent.id)?.status).toBe('active');
  });

  it('a suspended agent keeps its grants but exercises none until reactivated', async () => {
    const h = harness();
    const agent = await createManager(h);
    await h.service.grantDelegation(ALICE, agent.id, { capabilityId: 'knowledge.search' });
    await h.service.setAgentStatus(ALICE, agent.id, 'suspended');
    let view = await h.service.inspectAgent(ALICE, agent.id);
    expect(view.ok && view.view.effectiveCapabilityIds).toEqual([]);
    expect(view.ok && view.view.delegations).toHaveLength(1);
    await h.service.setAgentStatus(ALICE, agent.id, 'active');
    view = await h.service.inspectAgent(ALICE, agent.id);
    expect(view.ok && view.view.effectiveCapabilityIds).toEqual(['knowledge.search']);
  });
});

describe('nothing is ever deleted', () => {
  it('repositories keep every agent and delegation after revocations', async () => {
    const h = harness();
    const a = await createManager(h);
    const b = await createManager(h);
    const d1 = await h.service.grantDelegation(ALICE, a.id, { capabilityId: 'knowledge.search' });
    const d2 = await h.service.grantDelegation(ALICE, a.id, {
      capabilityId: 'projects.find_project',
    });
    const d3 = await h.service.grantDelegation(ALICE, b.id, { capabilityId: 'hr.find_employee' });
    if (!d1.ok || !d2.ok || !d3.ok) throw new Error('grant failed');

    await h.service.revokeDelegation(ALICE, a.id, d1.delegation.id);
    await h.service.setAgentStatus(ALICE, a.id, 'revoked');
    await h.service.setAgentStatus(ALICE, b.id, 'suspended');

    expect(h.agents.agents.size).toBe(2);
    expect(h.delegations.delegations.size).toBe(3);
    expect(h.agents.agents.get(a.id)?.status).toBe('revoked');
    expect(h.delegations.delegations.get(d1.delegation.id)?.status).toBe('revoked');
    expect(h.delegations.delegations.get(d2.delegation.id)?.status).toBe('active');
    const listed = await h.service.listAgents(ALICE);
    expect(listed.map((view) => view.agent.id).sort()).toEqual([a.id, b.id].sort());
  });
});
