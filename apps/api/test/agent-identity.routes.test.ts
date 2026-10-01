/**
 * Prompt 4 — agent identity + delegation MANAGEMENT API tests
 * (`fastify.inject`) for `/api/agents` (apps/api/src/routes/agents.ts).
 *
 * Every request runs the REAL route → strict trusted scope → RBAC →
 * AgentIdentityService → audit path (no mocks). Covered here:
 * - authentication (401) and strict scope (foreign org / non-member
 *   workspace → 403, never a silent fallback)
 * - RBAC: `agents.manage` gates create + delegations; `agent.use` gates reads
 * - agent creation grants NOTHING; unknown definitions are refused
 * - delegation rules: the grantor's own authority, the human-only set, the
 *   definition ceiling, resource scope support + existence, bounded expiry
 * - WHO grants and WHERE come from the session, never the request body
 * - idempotent delegation revoke (record kept) and the agent status machine
 *   (suspend → reactivate → revoke; revoked is terminal)
 * - tenant + workspace isolation of agent ids (404)
 * - Audit Center rows for the management events and blocked grants
 */

import { describe, expect, it } from 'vitest';
import type { LightMyRequestResponse } from 'fastify';

import {
  chatClient,
  currentUserId,
  onboardOrgAndWorkspace,
  provisionAgent,
  seedOrganization,
  seedProject,
  seedWorkspace,
  seedWorkspaceMembership,
  type ChatClient,
} from './helpers.js';

interface Scope {
  organizationId: string;
  workspaceId: string;
}

interface DelegationView {
  id: string;
  capabilityId: string;
  status: string;
  effectiveStatus: string;
  grantedByUserId: string;
  organizationId: string;
  workspaceId: string;
  expiresAt?: string;
  resourceScope?: { kind: string; id: string };
}

interface AgentView {
  agent: { id: string; status: string; definitionId: string; name: string };
  delegations: DelegationView[];
  effectiveCapabilityIds: string[];
  definitionCapabilityIds: string[];
}

interface AuditEvent {
  source: string;
  status: string;
  action: string;
  detail?: string;
  agent?: { id: string; name?: string; definitionId?: string };
  delegationIds?: string[];
}

const DAY_MS = 24 * 60 * 60 * 1000;

function qs(scope: Scope): string {
  return `organizationId=${scope.organizationId}&workspaceId=${scope.workspaceId}`;
}

/** A logged-in CEO (owner of the default engineering workspace). */
async function ceoClient(): Promise<{ client: ChatClient; scope: Scope; q: string }> {
  const client = await chatClient();
  const scope = await onboardOrgAndWorkspace(client);
  return { client, scope, q: qs(scope) };
}

async function createAgent(
  client: ChatClient,
  q: string,
  definitionId = 'executive',
  name = 'Exec Agent',
): Promise<string> {
  const response = await client.post(`/api/agents?${q}`, { definitionId, name });
  expect(response.statusCode).toBe(201);
  return (response.json() as { agent: { id: string } }).agent.id;
}

async function inspect(client: ChatClient, q: string, agentId: string): Promise<AgentView> {
  const response = await client.get(`/api/agents/${agentId}?${q}`);
  expect(response.statusCode).toBe(200);
  return response.json() as AgentView;
}

function grant(
  client: ChatClient,
  q: string,
  agentId: string,
  body: Record<string, unknown>,
): Promise<LightMyRequestResponse> {
  return client.post(`/api/agents/${agentId}/delegations?${q}`, body);
}

function reasonOf(response: LightMyRequestResponse): string | undefined {
  return (response.json() as { error?: { reason?: string } }).error?.reason;
}

async function auditEvents(client: ChatClient, q: string): Promise<AuditEvent[]> {
  const response = await client.get(`/api/audit/events?${q}&limit=500`);
  expect(response.statusCode).toBe(200);
  return (response.json() as { events: AuditEvent[] }).events;
}

/** Seeds a workspace the current user is a `member` of (→ technology.developer). */
async function seedMemberWorkspace(client: ChatClient, organizationId: string): Promise<Scope> {
  const workspaceId = 'wsp_agents_member';
  await seedWorkspace(client.repos, { id: workspaceId, organizationId, slug: 'agents-member' });
  await seedWorkspaceMembership(client.repos, {
    workspaceId,
    userId: currentUserId(client),
    role: 'member',
    organizationId,
  });
  return { organizationId, workspaceId };
}

describe('/api/agents — authentication and strict scope', () => {
  it('rejects unauthenticated access with 401 on every management verb', async () => {
    const { client, q } = await ceoClient();
    const agentId = await createAgent(client, q);
    const requests = [
      { method: 'GET' as const, url: `/api/agents?${q}` },
      {
        method: 'POST' as const,
        url: `/api/agents?${q}`,
        payload: { definitionId: 'executive', name: 'x' },
      },
      { method: 'GET' as const, url: `/api/agents/${agentId}?${q}` },
      {
        method: 'POST' as const,
        url: `/api/agents/${agentId}/delegations?${q}`,
        payload: { capabilityId: 'knowledge.search' },
      },
      { method: 'POST' as const, url: `/api/agents/${agentId}/suspend?${q}`, payload: {} },
    ];
    for (const request of requests) {
      const response = await client.app.inject(request);
      expect(response.statusCode, request.url).toBe(401);
    }
    // Nothing was granted or changed by the unauthenticated calls.
    const view = await inspect(client, q, agentId);
    expect(view.agent.status).toBe('active');
    expect(view.delegations).toEqual([]);
  });

  it('refuses a foreign organizationId with 403 (no fallback to the caller org)', async () => {
    const { client, scope, q } = await ceoClient();
    await seedOrganization(client.repos, { id: 'org_foreign_agents', slug: 'foreign-agents' });
    await seedWorkspace(client.repos, {
      id: 'wsp_foreign_agents',
      organizationId: 'org_foreign_agents',
      slug: 'foreign-agents-ws',
    });
    const foreign = qs({ organizationId: 'org_foreign_agents', workspaceId: 'wsp_foreign_agents' });
    const mixed = qs({ organizationId: 'org_foreign_agents', workspaceId: scope.workspaceId });

    for (const query of [foreign, mixed]) {
      expect((await client.get(`/api/agents?${query}`)).statusCode).toBe(403);
      const create = await client.post(`/api/agents?${query}`, {
        definitionId: 'executive',
        name: 'Nope',
      });
      expect(create.statusCode).toBe(403);
    }
    // Positive control: the caller's own scope works.
    expect((await client.get(`/api/agents?${q}`)).statusCode).toBe(200);
    const listed = (await client.get(`/api/agents?${q}`)).json() as { agents: AgentView[] };
    expect(listed.agents).toEqual([]);
  });

  it('refuses a workspace the caller is not a member of with 403', async () => {
    const { client, scope, q } = await ceoClient();
    await seedWorkspace(client.repos, {
      id: 'wsp_not_member',
      organizationId: scope.organizationId,
      slug: 'not-member',
    });
    const nonMember = qs({ organizationId: scope.organizationId, workspaceId: 'wsp_not_member' });
    expect((await client.get(`/api/agents?${nonMember}`)).statusCode).toBe(403);
    const create = await client.post(`/api/agents?${nonMember}`, {
      definitionId: 'executive',
      name: 'Nope',
    });
    expect(create.statusCode).toBe(403);
    // Nothing was created anywhere in the org.
    expect(client.repos.agents).toBeDefined();
    expect(
      (await client.repos.agents?.listByWorkspace(scope.organizationId, 'wsp_not_member'))?.length,
    ).toBe(0);
    // Positive control.
    expect((await client.get(`/api/agents?${q}`)).statusCode).toBe(200);
  });
});

describe('/api/agents — RBAC', () => {
  it('a member (technology.developer) cannot create agents or grant delegations but may list/inspect', async () => {
    const { client, scope, q } = await ceoClient();
    const member = await seedMemberWorkspace(client, scope.organizationId);
    const mq = qs(member);

    const roleContext = await client.get(`/api/role-context?${mq}`);
    expect(roleContext.statusCode).toBe(200);
    const current = (roleContext.json() as { current: { roleId: string; permissions: string[] } })
      .current;
    expect(current.roleId).toBe('technology.developer');
    expect(current.permissions).toContain('agent.use');
    expect(current.permissions).not.toContain('agents.manage');

    const create = await client.post(`/api/agents?${mq}`, {
      definitionId: 'developer',
      name: 'Dev Agent',
    });
    expect(create.statusCode).toBe(403);
    // Refused by the RBAC gate (agents.manage), not by a service rule.
    expect(reasonOf(create)).toBeUndefined();
    expect((create.json() as { error: { message: string } }).error.message).toContain(
      'manage agents',
    );
    expect(
      await client.repos.agents?.listByWorkspace(member.organizationId, member.workspaceId),
    ).toEqual([]);

    // An agent already exists in the member workspace (seeded by trusted code).
    const { agentId } = await provisionAgent(client.repos, {
      organizationId: member.organizationId,
      workspaceId: member.workspaceId,
      definitionId: 'developer',
      grantedBy: currentUserId(client),
      capabilityIds: [],
    });
    const delegate = await grant(client, mq, agentId, { capabilityId: 'knowledge.search' });
    expect(delegate.statusCode).toBe(403);
    expect(reasonOf(delegate)).toBeUndefined();
    expect((delegate.json() as { error: { message: string } }).error.message).toContain(
      'manage agents',
    );
    const suspend = await client.post(`/api/agents/${agentId}/suspend?${mq}`, {});
    expect(suspend.statusCode).toBe(403);
    expect(reasonOf(suspend)).toBeUndefined();

    // agent.use: reads are allowed.
    const list = await client.get(`/api/agents?${mq}`);
    expect(list.statusCode).toBe(200);
    const agents = (list.json() as { agents: AgentView[] }).agents;
    expect(agents.map((view) => view.agent.id)).toEqual([agentId]);
    const view = await inspect(client, mq, agentId);
    expect(view.delegations).toEqual([]);
    expect(view.agent.status).toBe('active');

    // Positive control: the same user, as CEO in the default workspace, may manage.
    const ceoAgent = await createAgent(client, q);
    const ok = await grant(client, q, ceoAgent, { capabilityId: 'knowledge.search' });
    expect(ok.statusCode).toBe(201);
  });
});

describe('/api/agents — create, list, inspect', () => {
  it('creates an active agent that grants nothing, and lists it', async () => {
    const { client, scope, q } = await ceoClient();
    const response = await client.post(`/api/agents?${q}`, {
      definitionId: 'executive',
      name: '  Chief of Staff  ',
      description: 'Helps the CEO',
    });
    expect(response.statusCode).toBe(201);
    const agent = (
      response.json() as {
        agent: {
          id: string;
          status: string;
          name: string;
          organizationId: string;
          workspaceId: string;
          ownerUserId: string;
          createdBy: string;
        };
      }
    ).agent;
    expect(agent.id).toMatch(/^agt_/);
    expect(agent.status).toBe('active');
    expect(agent.name).toBe('Chief of Staff');
    expect(agent.organizationId).toBe(scope.organizationId);
    expect(agent.workspaceId).toBe(scope.workspaceId);
    expect(agent.ownerUserId).toBe(currentUserId(client));
    expect(agent.createdBy).toBe(currentUserId(client));

    const view = await inspect(client, q, agent.id);
    expect(view.effectiveCapabilityIds).toEqual([]);
    expect(view.delegations).toEqual([]);
    expect(view.definitionCapabilityIds).toContain('projects.find_project');

    const second = await createAgent(client, q, 'finance', 'Finance Agent');
    const list = await client.get(`/api/agents?${q}`);
    expect(list.statusCode).toBe(200);
    const ids = (list.json() as { agents: AgentView[] }).agents.map((entry) => entry.agent.id);
    expect(ids).toHaveLength(2);
    expect(ids).toEqual(expect.arrayContaining([agent.id, second]));
  });

  it('refuses an unknown definition with 400 UNKNOWN_DEFINITION', async () => {
    const { client, q } = await ceoClient();
    const response = await client.post(`/api/agents?${q}`, {
      definitionId: 'god_mode',
      name: 'Nope',
    });
    expect(response.statusCode).toBe(400);
    expect(reasonOf(response)).toBe('UNKNOWN_DEFINITION');
    const list = (await client.get(`/api/agents?${q}`)).json() as { agents: AgentView[] };
    expect(list.agents).toEqual([]);
  });
});

describe('/api/agents/:agentId/delegations — grant rules', () => {
  it('grants a capability the CEO holds; inspect shows it active and effective', async () => {
    const { client, scope, q } = await ceoClient();
    const agentId = await createAgent(client, q);
    const response = await grant(client, q, agentId, {
      capabilityId: 'projects.find_project',
      note: 'weekly review',
    });
    expect(response.statusCode).toBe(201);
    const delegation = (response.json() as { delegation: DelegationView }).delegation;
    expect(delegation.id).toMatch(/^dlg_/);
    expect(delegation.status).toBe('active');
    expect(delegation.grantedByUserId).toBe(currentUserId(client));
    expect(delegation.organizationId).toBe(scope.organizationId);
    expect(delegation.workspaceId).toBe(scope.workspaceId);

    const view = await inspect(client, q, agentId);
    expect(view.delegations).toHaveLength(1);
    expect(view.delegations[0]).toMatchObject({
      id: delegation.id,
      capabilityId: 'projects.find_project',
      effectiveStatus: 'active',
    });
    expect(view.effectiveCapabilityIds).toEqual(['projects.find_project']);
  });

  it('refuses a capability the CEO does not hold (403 DELEGATION_EXCEEDS_USER_AUTHORITY), persists nothing, audits a blocked row', async () => {
    const { client, q } = await ceoClient();
    // Precondition: the CEO in the engineering workspace holds no finance authority.
    const roleContext = (
      (await client.get(`/api/role-context?${q}`)).json() as {
        current: { roleId: string; permissions: string[] };
      }
    ).current;
    expect(roleContext.roleId).toBe('executive.ceo');
    expect(roleContext.permissions.some((permission) => permission.startsWith('finance.'))).toBe(
      false,
    );

    // The finance definition's ceiling includes finance.submit_expense, so
    // the ONLY reason to refuse is the grantor's own authority.
    const agentId = await createAgent(client, q, 'finance', 'Finance Agent');
    const denied = await grant(client, q, agentId, { capabilityId: 'finance.submit_expense' });
    expect(denied.statusCode).toBe(403);
    expect(reasonOf(denied)).toBe('DELEGATION_EXCEEDS_USER_AUTHORITY');

    let view = await inspect(client, q, agentId);
    expect(view.definitionCapabilityIds).toContain('finance.submit_expense');
    expect(view.delegations).toEqual([]);
    expect(view.effectiveCapabilityIds).toEqual([]);

    const blocked = (await auditEvents(client, q)).filter(
      (event) =>
        event.source === 'activity' &&
        event.status === 'blocked' &&
        (event.detail ?? '').includes('DELEGATION_EXCEEDS_USER_AUTHORITY'),
    );
    expect(blocked).toHaveLength(1);
    expect(blocked[0]?.agent?.id).toBe(agentId);
    expect(blocked[0]?.detail).toContain('finance.submit_expense');

    // Positive control: a capability of the same definition the CEO DOES hold.
    const ok = await grant(client, q, agentId, {
      capabilityId: 'notifications.what_needs_attention',
    });
    expect(ok.statusCode).toBe(201);
    view = await inspect(client, q, agentId);
    expect(view.effectiveCapabilityIds).toEqual(['notifications.what_needs_attention']);
  });

  it('refuses human-only approvals.decide with 403 CAPABILITY_NOT_DELEGABLE (even though the CEO holds it)', async () => {
    const { client, q } = await ceoClient();
    const permissions = (
      (await client.get(`/api/role-context?${q}`)).json() as {
        current: { permissions: string[] };
      }
    ).current.permissions;
    expect(permissions).toContain('approvals.decide');

    const agentId = await createAgent(client, q);
    for (const capabilityId of ['approvals.decide', 'agents.manage', 'audit.read']) {
      const denied = await grant(client, q, agentId, { capabilityId });
      expect(denied.statusCode, capabilityId).toBe(403);
      expect(reasonOf(denied), capabilityId).toBe('CAPABILITY_NOT_DELEGABLE');
    }
    expect((await inspect(client, q, agentId)).delegations).toEqual([]);
    const blocked = (await auditEvents(client, q)).filter(
      (event) =>
        event.status === 'blocked' && (event.detail ?? '').includes('CAPABILITY_NOT_DELEGABLE'),
    );
    expect(blocked.length).toBeGreaterThanOrEqual(3);

    // Positive control.
    expect((await grant(client, q, agentId, { capabilityId: 'knowledge.search' })).statusCode).toBe(
      201,
    );
  });

  it('refuses a capability outside the agent definition with 403 CAPABILITY_OUTSIDE_AGENT_DEFINITION', async () => {
    const { client, q } = await ceoClient();
    const agentId = await createAgent(client, q);
    for (const capabilityId of ['workflow.hire_and_assign_employee', 'finance.submit_expense']) {
      const denied = await grant(client, q, agentId, { capabilityId });
      expect(denied.statusCode, capabilityId).toBe(403);
      expect(reasonOf(denied), capabilityId).toBe('CAPABILITY_OUTSIDE_AGENT_DEFINITION');
    }
    expect((await inspect(client, q, agentId)).delegations).toEqual([]);
    // Positive control: inside the ceiling.
    expect(
      (await grant(client, q, agentId, { capabilityId: 'calendar.create_event' })).statusCode,
    ).toBe(201);
  });

  it('refuses a resource scope on an unsupported capability / kind with 400 RESOURCE_SCOPE_UNSUPPORTED', async () => {
    const { client, scope, q } = await ceoClient();
    await seedProject(client.repos, {
      id: 'prj_own_scope',
      organizationId: scope.organizationId,
      name: 'Own Project',
    });
    const agentId = await createAgent(client, q);
    const unsupportedCapability = await grant(client, q, agentId, {
      capabilityId: 'knowledge.search',
      resourceScope: { kind: 'project', id: 'prj_own_scope' },
    });
    expect(unsupportedCapability.statusCode).toBe(400);
    expect(reasonOf(unsupportedCapability)).toBe('RESOURCE_SCOPE_UNSUPPORTED');
    const wrongKind = await grant(client, q, agentId, {
      capabilityId: 'projects.find_project',
      resourceScope: { kind: 'budget', id: 'bdg_any' },
    });
    expect(wrongKind.statusCode).toBe(400);
    expect(reasonOf(wrongKind)).toBe('RESOURCE_SCOPE_UNSUPPORTED');
    expect((await inspect(client, q, agentId)).delegations).toEqual([]);

    // Positive control: a supported capability scoped to an own project.
    const ok = await grant(client, q, agentId, {
      capabilityId: 'projects.find_project',
      resourceScope: { kind: 'project', id: 'prj_own_scope' },
    });
    expect(ok.statusCode).toBe(201);
    expect((ok.json() as { delegation: DelegationView }).delegation.resourceScope).toEqual({
      kind: 'project',
      id: 'prj_own_scope',
    });
  });

  it("refuses a project scope naming another organization's project with 400 RESOURCE_NOT_FOUND", async () => {
    const { client, scope, q } = await ceoClient();
    await seedOrganization(client.repos, { id: 'org_other_scope', slug: 'other-scope' });
    await seedProject(client.repos, {
      id: 'prj_other_org',
      organizationId: 'org_other_scope',
      name: 'Their Project',
    });
    await seedProject(client.repos, {
      id: 'prj_mine',
      organizationId: scope.organizationId,
      name: 'My Project',
    });
    const agentId = await createAgent(client, q);
    for (const id of ['prj_other_org', 'prj_does_not_exist']) {
      const denied = await grant(client, q, agentId, {
        capabilityId: 'projects.find_project',
        resourceScope: { kind: 'project', id },
      });
      expect(denied.statusCode, id).toBe(400);
      expect(reasonOf(denied), id).toBe('RESOURCE_NOT_FOUND');
    }
    expect((await inspect(client, q, agentId)).delegations).toEqual([]);
    // Positive control.
    const ok = await grant(client, q, agentId, {
      capabilityId: 'projects.find_project',
      resourceScope: { kind: 'project', id: 'prj_mine' },
    });
    expect(ok.statusCode).toBe(201);
  });

  it('refuses an expiry in the past, beyond 90 days, or unparseable with 400 EXPIRY_INVALID', async () => {
    const { client, q } = await ceoClient();
    const agentId = await createAgent(client, q);
    const now = Date.now();
    for (const expiresAt of [
      new Date(now - 60_000).toISOString(),
      new Date(now + 91 * DAY_MS).toISOString(),
      'not-a-date',
    ]) {
      const denied = await grant(client, q, agentId, {
        capabilityId: 'knowledge.search',
        expiresAt,
      });
      expect(denied.statusCode, expiresAt).toBe(400);
      expect(reasonOf(denied), expiresAt).toBe('EXPIRY_INVALID');
    }
    expect((await inspect(client, q, agentId)).delegations).toEqual([]);

    // Positive control: 30 days out is within bounds.
    const expiresAt = new Date(now + 30 * DAY_MS).toISOString();
    const ok = await grant(client, q, agentId, { capabilityId: 'knowledge.search', expiresAt });
    expect(ok.statusCode).toBe(201);
    expect((ok.json() as { delegation: DelegationView }).delegation.expiresAt).toBe(expiresAt);
  });

  it('never takes WHO grants or WHERE from the body (forged fields do not reach the delegation)', async () => {
    // NOTE: the route schema declares additionalProperties:false, but Fastify's
    // default Ajv config (removeAdditional: true) STRIPS unknown fields rather
    // than rejecting them with 400. The security property — the grantor, org,
    // workspace, and status come from the session — is asserted here.
    const { client, scope, q } = await ceoClient();
    await seedOrganization(client.repos, { id: 'org_forged', slug: 'forged' });
    const agentId = await createAgent(client, q);
    const response = await grant(client, q, agentId, {
      capabilityId: 'knowledge.search',
      grantedByUserId: 'usr_forged',
      organizationId: 'org_forged',
      workspaceId: 'wsp_forged',
      status: 'revoked',
    });
    expect([201, 400]).toContain(response.statusCode);
    const view = await inspect(client, q, agentId);
    if (response.statusCode === 400) {
      expect(view.delegations).toEqual([]);
      return;
    }
    const delegation = (response.json() as { delegation: DelegationView }).delegation;
    expect(delegation.grantedByUserId).toBe(currentUserId(client));
    expect(delegation.organizationId).toBe(scope.organizationId);
    expect(delegation.workspaceId).toBe(scope.workspaceId);
    expect(delegation.status).toBe('active');
    expect(view.delegations).toHaveLength(1);
    expect(view.delegations[0]).toMatchObject({
      grantedByUserId: currentUserId(client),
      organizationId: scope.organizationId,
      workspaceId: scope.workspaceId,
      status: 'active',
    });
    const persisted = await client.repos.agentDelegations?.findById('org_forged', delegation.id);
    expect(persisted).toBeUndefined();
  });
});

describe('/api/agents — forged body fields on create / status', () => {
  it('create and status bodies cannot set org, workspace, owner, creator, or status', async () => {
    // Same Ajv note as above: unknown fields are stripped (201/200), not 400.
    const { client, scope, q } = await ceoClient();
    await seedOrganization(client.repos, { id: 'org_forged_create', slug: 'forged-create' });
    const created = await client.post(`/api/agents?${q}`, {
      definitionId: 'executive',
      name: 'Forged',
      organizationId: 'org_forged_create',
      workspaceId: 'wsp_forged_create',
      ownerUserId: 'usr_forged',
      createdBy: 'usr_forged',
      status: 'revoked',
      id: 'agt_forged_fixed_id',
    });
    expect([201, 400]).toContain(created.statusCode);
    if (created.statusCode === 400) {
      expect(
        ((await client.get(`/api/agents?${q}`)).json() as { agents: AgentView[] }).agents,
      ).toEqual([]);
      return;
    }
    const agent = (
      created.json() as {
        agent: {
          id: string;
          status: string;
          organizationId: string;
          workspaceId: string;
          ownerUserId: string;
          createdBy: string;
        };
      }
    ).agent;
    expect(agent.id).not.toBe('agt_forged_fixed_id');
    expect(agent).toMatchObject({
      status: 'active',
      organizationId: scope.organizationId,
      workspaceId: scope.workspaceId,
      ownerUserId: currentUserId(client),
      createdBy: currentUserId(client),
    });
    expect(await client.repos.agents?.findById('org_forged_create', agent.id)).toBeUndefined();

    // A suspend body carrying status:'active' still suspends.
    const suspended = await client.post(`/api/agents/${agent.id}/suspend?${q}`, {
      reason: 'x',
      status: 'active',
    });
    expect([200, 400]).toContain(suspended.statusCode);
    const expected = suspended.statusCode === 200 ? 'suspended' : 'active';
    expect((await inspect(client, q, agent.id)).agent.status).toBe(expected);
  });
});

describe('/api/agents — revoke and status lifecycle', () => {
  it('revokes a delegation idempotently and keeps the record', async () => {
    const { client, q } = await ceoClient();
    const agentId = await createAgent(client, q);
    const granted = await grant(client, q, agentId, { capabilityId: 'knowledge.search' });
    expect(granted.statusCode).toBe(201);
    const delegationId = (granted.json() as { delegation: DelegationView }).delegation.id;
    expect((await inspect(client, q, agentId)).effectiveCapabilityIds).toEqual([
      'knowledge.search',
    ]);

    const url = `/api/agents/${agentId}/delegations/${delegationId}/revoke?${q}`;
    const first = await client.post(url, { reason: 'no longer needed' });
    expect(first.statusCode).toBe(200);
    expect((first.json() as { changed: boolean }).changed).toBe(true);
    const second = await client.post(url, {});
    expect(second.statusCode).toBe(200);
    expect((second.json() as { changed: boolean }).changed).toBe(false);

    const view = await inspect(client, q, agentId);
    expect(view.delegations).toHaveLength(1);
    expect(view.delegations[0]).toMatchObject({
      id: delegationId,
      status: 'revoked',
      effectiveStatus: 'revoked',
    });
    expect(view.effectiveCapabilityIds).toEqual([]);

    // Only ONE revocation audit row (the idempotent repeat publishes nothing).
    const revokedRows = (await auditEvents(client, q)).filter(
      (event) =>
        event.source === 'activity' &&
        event.agent?.id === agentId &&
        (event.delegationIds ?? []).includes(delegationId) &&
        event.status === 'recorded' &&
        /revok/i.test(event.action),
    );
    expect(revokedRows).toHaveLength(1);

    // An unknown delegation id is 404.
    const unknown = await client.post(
      `/api/agents/${agentId}/delegations/dlg_does_not_exist/revoke?${q}`,
      {},
    );
    expect(unknown.statusCode).toBe(404);
    expect(reasonOf(unknown)).toBe('DELEGATION_NOT_FOUND');
  });

  it('suspends, reactivates, then revokes; a revoked agent cannot be reactivated (409 AGENT_REVOKED)', async () => {
    const { client, q } = await ceoClient();
    const agentId = await createAgent(client, q);
    const status = async (verb: string): Promise<LightMyRequestResponse> =>
      client.post(`/api/agents/${agentId}/${verb}?${q}`, { reason: `${verb} test` });

    const suspended = await status('suspend');
    expect(suspended.statusCode).toBe(200);
    expect(suspended.json()).toMatchObject({ agent: { status: 'suspended' }, changed: true });
    // A suspended agent cannot receive delegations.
    const whileSuspended = await grant(client, q, agentId, { capabilityId: 'knowledge.search' });
    expect(whileSuspended.statusCode).toBe(409);
    expect(reasonOf(whileSuspended)).toBe('AGENT_NOT_ACTIVE');

    const again = await status('suspend');
    expect(again.statusCode).toBe(200);
    expect((again.json() as { changed: boolean }).changed).toBe(false);

    const reactivated = await status('reactivate');
    expect(reactivated.statusCode).toBe(200);
    expect(reactivated.json()).toMatchObject({ agent: { status: 'active' }, changed: true });
    expect((await grant(client, q, agentId, { capabilityId: 'knowledge.search' })).statusCode).toBe(
      201,
    );

    const revoked = await status('revoke');
    expect(revoked.statusCode).toBe(200);
    expect(revoked.json()).toMatchObject({ agent: { status: 'revoked' }, changed: true });

    for (const verb of ['reactivate', 'suspend']) {
      const refused = await status(verb);
      expect(refused.statusCode, verb).toBe(409);
      expect(reasonOf(refused), verb).toBe('AGENT_REVOKED');
    }
    const grantAfterRevoke = await grant(client, q, agentId, {
      capabilityId: 'projects.find_project',
    });
    expect(grantAfterRevoke.statusCode).toBe(409);
    expect(reasonOf(grantAfterRevoke)).toBe('AGENT_REVOKED');

    const view = await inspect(client, q, agentId);
    expect(view.agent.status).toBe('revoked');
    // The historical delegation record is kept; a revoked agent is effective for nothing.
    expect(view.delegations).toHaveLength(1);
    expect(view.effectiveCapabilityIds).toEqual([]);
  });
});

describe('/api/agents — tenant and workspace isolation', () => {
  it("returns 404 for another organization's agent on inspect / grant / revoke / status", async () => {
    const { client, q } = await ceoClient();
    await seedOrganization(client.repos, { id: 'org_agents_other', slug: 'agents-other' });
    const foreignAgentId = 'agt_foreign_org_agent';
    const at = '2026-01-01T00:00:00.000Z';
    await client.repos.agents?.save({
      id: foreignAgentId,
      organizationId: 'org_agents_other',
      workspaceId: 'wsp_agents_other',
      definitionId: 'executive',
      name: 'Foreign agent',
      description: 'not yours',
      status: 'active',
      ownerUserId: 'usr_other',
      createdBy: 'usr_other',
      createdAt: at,
      updatedAt: at,
    });
    await client.repos.agentDelegations?.save({
      id: 'dlg_foreign_org_1',
      agentId: foreignAgentId,
      organizationId: 'org_agents_other',
      workspaceId: 'wsp_agents_other',
      grantedByUserId: 'usr_other',
      capabilityId: 'knowledge.search',
      status: 'active',
      createdAt: at,
    });

    const inspectForeign = await client.get(`/api/agents/${foreignAgentId}?${q}`);
    expect(inspectForeign.statusCode).toBe(404);
    const grantForeign = await grant(client, q, foreignAgentId, {
      capabilityId: 'knowledge.search',
    });
    expect(grantForeign.statusCode).toBe(404);
    expect(reasonOf(grantForeign)).toBe('AGENT_NOT_FOUND');
    const revokeForeign = await client.post(
      `/api/agents/${foreignAgentId}/delegations/dlg_foreign_org_1/revoke?${q}`,
      {},
    );
    expect(revokeForeign.statusCode).toBe(404);
    for (const verb of ['suspend', 'revoke']) {
      expect((await client.post(`/api/agents/${foreignAgentId}/${verb}?${q}`, {})).statusCode).toBe(
        404,
      );
    }
    // The foreign agent and its delegation are untouched.
    const stored = await client.repos.agents?.findById('org_agents_other', foreignAgentId);
    expect(stored?.status).toBe('active');
    const storedDelegations = await client.repos.agentDelegations?.listByAgent(
      'org_agents_other',
      foreignAgentId,
    );
    expect(storedDelegations?.map((delegation) => delegation.status)).toEqual(['active']);
    // Not listed in the caller's workspace.
    const list = (await client.get(`/api/agents?${q}`)).json() as { agents: AgentView[] };
    expect(list.agents).toEqual([]);

    // Positive control: an own agent resolves.
    const own = await createAgent(client, q);
    expect((await client.get(`/api/agents/${own}?${q}`)).statusCode).toBe(200);
  });

  it('returns 404 from this workspace for an agent of another workspace in the same org', async () => {
    const { client, scope, q } = await ceoClient();
    const member = await seedMemberWorkspace(client, scope.organizationId);
    const { agentId, delegationIds } = await provisionAgent(client.repos, {
      organizationId: scope.organizationId,
      workspaceId: member.workspaceId,
      definitionId: 'executive',
      grantedBy: currentUserId(client),
      capabilityIds: ['knowledge.search'],
    });
    const delegationId = delegationIds[0] ?? '';

    expect((await client.get(`/api/agents/${agentId}?${q}`)).statusCode).toBe(404);
    const grantOther = await grant(client, q, agentId, { capabilityId: 'projects.find_project' });
    expect(grantOther.statusCode).toBe(404);
    expect(reasonOf(grantOther)).toBe('AGENT_NOT_FOUND');
    const revokeOther = await client.post(
      `/api/agents/${agentId}/delegations/${delegationId}/revoke?${q}`,
      {},
    );
    expect(revokeOther.statusCode).toBe(404);
    expect((await client.post(`/api/agents/${agentId}/suspend?${q}`, {})).statusCode).toBe(404);
    const list = (await client.get(`/api/agents?${q}`)).json() as { agents: AgentView[] };
    expect(list.agents).toEqual([]);

    // Positive control: from ITS workspace the agent resolves, unchanged.
    const view = await inspect(client, qs(member), agentId);
    expect(view.agent.status).toBe('active');
    expect(view.delegations.map((delegation) => delegation.status)).toEqual(['active']);
  });
});

describe('/api/agents — Audit Center', () => {
  it('records agent.created and delegation granted/revoked as activity rows carrying the agent id', async () => {
    const { client, q } = await ceoClient();
    const agentId = await createAgent(client, q, 'executive', 'Audited Agent');
    const granted = await grant(client, q, agentId, { capabilityId: 'knowledge.search' });
    expect(granted.statusCode).toBe(201);
    const delegationId = (granted.json() as { delegation: DelegationView }).delegation.id;
    const revoked = await client.post(
      `/api/agents/${agentId}/delegations/${delegationId}/revoke?${q}`,
      {},
    );
    expect(revoked.statusCode).toBe(200);

    const events = await auditEvents(client, q);
    const agentRows = events.filter(
      (event) => event.source === 'activity' && event.agent?.id === agentId,
    );
    // created + granted + revoked, all recorded (not blocked).
    expect(agentRows).toHaveLength(3);
    for (const row of agentRows) {
      expect(row.status).toBe('recorded');
      expect(row.agent).toMatchObject({
        id: agentId,
        name: 'Audited Agent',
        definitionId: 'executive',
      });
      expect(row.detail).toContain(`agent id: ${agentId}`);
    }
    const delegationRows = agentRows.filter((row) =>
      (row.delegationIds ?? []).includes(delegationId),
    );
    expect(delegationRows).toHaveLength(2);
    const createdRow = agentRows.find((row) => (row.delegationIds ?? []).length === 0);
    expect(createdRow?.action).toMatch(/^Agent created: Audited Agent/);
    expect(delegationRows.some((row) => /delegated/i.test(row.action))).toBe(true);
    expect(delegationRows.some((row) => /revok/i.test(row.action))).toBe(true);
    for (const row of delegationRows) expect(row.action).toContain('knowledge.search');

    // The agentId filter narrows to this agent's rows.
    const filtered = await client.get(`/api/audit/events?${q}&agentId=${agentId}`);
    expect(filtered.statusCode).toBe(200);
    const filteredEvents = (filtered.json() as { events: AuditEvent[] }).events;
    expect(filteredEvents.length).toBe(3);
    expect(filteredEvents.every((event) => event.agent?.id === agentId)).toBe(true);
  });
});
