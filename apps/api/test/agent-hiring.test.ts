/**
 * Agent hiring capability + agent resume authority (`fastify.inject`).
 *
 * The HR agent definition is the only one whose ceiling contains
 * `hr.create_employee` (and the hire-and-assign composite's inner steps). It
 * grants NOTHING on its own: every hire needs an explicit human delegation,
 * the requester's own authority, policy, and a human approval decided by
 * someone other than the requester. These tests drive the REAL path
 * (agent route -> orchestrator -> approval decision route -> resumed run as
 * the agent) over the multi-user evaluation world:
 *   meera  = CEO (requester), vikram = delivery manager (the distinct approver).
 * Every refusal has the happy path as its positive control, and a refused
 * resume must leave NO employee behind.
 */

import { afterEach, describe, expect, it } from 'vitest';
import { WorkspaceMembership } from '@nexora/domain-workspaces';
import { buildBaseWorld, extendWorld, type WorldBuilder } from '@nexora/evaluation';

import { createScenarioApp, type ScenarioApp } from '../evaluation/harness.js';

const AUTHORITY = 'POLICY_APPROVAL_AUTHORITY';
const HIRE = 'Hire Sarah Agent and assign her to the Atlas project';
const COMPOSITE = 'workflow.hire_and_assign_employee';
const INNER = ['hr.create_employee', 'projects.find_project', 'projects.assign_employee'];
const HR_CAPS = [COMPOSITE, ...INNER];
const SOD = [
  { capabilityPrefix: 'hr.', separationOfDuties: true },
  { capabilityPrefix: 'workflow.', separationOfDuties: true },
];

interface Options {
  capabilities?: readonly string[];
  definition?: string;
  status?: 'active' | 'suspended' | 'revoked';
  expiresAt?: string;
  sod?: boolean;
}

describe('agent hiring: the HR agent, delegation, approval, attribution', () => {
  let harness: ScenarioApp | undefined;
  afterEach(async () => {
    await harness?.close();
    harness = undefined;
  });

  async function setup(options: Options = {}) {
    const base = buildBaseWorld();
    const world = extendWorld(base, 'hiring', (w: WorldBuilder) => {
      let out = w.agent('hr-agent', {
        organization: 'aurora',
        workspace: 'aurora-eng',
        definition: options.definition ?? 'hr',
        name: 'HR Agent',
        owner: 'meera',
        status: options.status ?? 'active',
      });
      for (const capability of options.capabilities ?? HR_CAPS) {
        out = out.delegation(`d-${capability}`, {
          agent: 'hr-agent',
          grantedBy: 'meera',
          capability,
          ...(options.expiresAt === undefined ? {} : { expiresAt: options.expiresAt }),
        });
      }
      if (options.sod !== false) {
        out = out.policy('sod', {
          organization: 'aurora',
          policyId: AUTHORITY,
          config: { rules: SOD },
          createdBy: 'meera',
        });
      }
      return out;
    });
    const app = await createScenarioApp(world);
    harness = app;
    const ids = {
      org: app.world.organization('aurora').id,
      ws: app.world.workspace('aurora-eng').id,
      agent: (app.world.entity('hr-agent') as { id: string }).id,
    };
    const scope = `organizationId=${ids.org}&workspaceId=${ids.ws}`;
    const run = (path = `/api/agents/${ids.agent}/execute`, actor = 'meera') =>
      app.request(actor, 'POST', `${path}?${scope}`, { utterance: HIRE });
    const employees = async () =>
      (await app.repos.employees.listByOrganization(ids.org as never)).filter((employee) =>
        employee.name.value.includes('Sarah Agent'),
      );
    const decide = (actor: string, approvalId: string) =>
      app.request(actor, 'POST', `/api/ai/approvals/${approvalId}/decision`, {
        decision: 'approve',
      });
    return { app, ids, scope, run, employees, decide };
  }

  async function gate(h: Awaited<ReturnType<typeof setup>>) {
    const response = await h.run();
    expect(response.statusCode).toBe(200);
    const body = response.json() as {
      outcome: { status: string; approvals: { id: string; toolId: string }[] };
    };
    expect(body.outcome.status).toBe('blocked');
    const approvalId = body.outcome.approvals[0]?.id ?? '';
    expect(approvalId).toMatch(/^apr_/);
    expect(await h.employees()).toHaveLength(0);
    return approvalId;
  }

  it('authorized HR agent: gate -> distinct human approves -> employee + assignment exist; requester != agent != approver', async () => {
    const h = await setup();
    const approvalId = await gate(h);

    // The requester (a CEO) is the SAME person the SoD rule forbids from approving.
    const self = await h.decide('meera', approvalId);
    expect(self.statusCode).toBe(403);
    expect(await h.employees()).toHaveLength(0);

    const approved = await h.decide('vikram', approvalId);
    expect(approved.statusCode).toBe(200);
    expect(approved.body).toContain('"status":"completed"');
    expect(await h.employees()).toHaveLength(1);

    const approval = await h.app.approvals.byId(approvalId);
    expect(approval?.userId).toBe(h.app.world.user('meera').id);
    expect(approval?.decidedBy).toBe(h.app.world.user('vikram').id);
    expect(approval?.agentId).toBe(h.ids.agent);
    expect(approval?.delegationId).toBeDefined();
    expect(approval?.separationOfDuties).toBe(true);
    // Three distinct principals.
    expect(new Set([approval?.userId, approval?.agentId, approval?.decidedBy]).size).toBe(3);

    // The resumed run is journaled as the agent acting for the requester.
    const journal = h.app.agentExecutions.records.filter((r) => r.approvalId === approvalId);
    expect(journal).toHaveLength(1);
    expect(journal[0]).toMatchObject({ agentIdentityId: h.ids.agent, status: 'completed' });
    expect(journal[0]?.userId).toBe(h.app.world.user('meera').id);
  });

  it('the agent can never approve its own hire (approvals.decide is non-delegable)', async () => {
    const h = await setup({ capabilities: [...HR_CAPS, 'approvals.decide'] });
    // Delegating a non-delegable capability was not stored as authority: it fails at grant time
    // for the REST path and can never satisfy the execution-time check.
    const approvalId = await gate(h);
    const attempt = await h.app.request(
      'meera',
      'POST',
      `/api/agents/${h.ids.agent}/execute?${h.scope}`,
      { utterance: `Approve approval ${approvalId}` },
    );
    expect(attempt.statusCode).toBe(200);
    expect((await h.app.approvals.byId(approvalId))?.status).toBe('awaiting_approval');
    expect(await h.employees()).toHaveLength(0);
  });

  it('an agent whose definition lacks hr.* (executive) is refused even with the delegations', async () => {
    const h = await setup({ definition: 'executive' });
    const response = await h.run();
    const body = response.json() as { outcome: { status: string; approvals: unknown[] } };
    expect(body.outcome.status).not.toBe('completed');
    expect(body.outcome.approvals).toHaveLength(0);
    expect(await h.employees()).toHaveLength(0);
  });

  it('no delegation: refused before any approval opens', async () => {
    const h = await setup({ capabilities: [] });
    const response = await h.run();
    const body = response.json() as { outcome: { status: string; approvals: unknown[] } };
    expect(body.outcome.status).not.toBe('blocked');
    expect(body.outcome.approvals).toHaveLength(0);
    expect(await h.employees()).toHaveLength(0);
  });

  it('a requester who lacks the capability cannot run the agent through it (developer)', async () => {
    const h = await setup();
    const response = await h.app.request(
      'arjun',
      'POST',
      `/api/agents/${h.ids.agent}/execute?${h.scope}`,
      { utterance: HIRE },
    );
    const body = response.json() as { outcome?: { approvals: unknown[] } };
    expect(body.outcome?.approvals ?? []).toHaveLength(0);
    expect(await h.employees()).toHaveLength(0);
  });

  it('wrong workspace: the agent of Engineering run from Executive is refused', async () => {
    const h = await setup();
    const exec = h.app.world.workspace('aurora-exec').id;
    const response = await h.app.request(
      'meera',
      'POST',
      `/api/agents/${h.ids.agent}/execute?organizationId=${h.ids.org}&workspaceId=${exec}`,
      { utterance: HIRE },
    );
    expect(response.statusCode).toBe(403);
    expect(await h.employees()).toHaveLength(0);
  });

  it('wrong organization: an agent id of another tenant resolves to 404', async () => {
    const h = await setup();
    const lena = await h.app.request(
      'lena',
      'POST',
      `/api/agents/${h.ids.agent}/execute?organizationId=${h.app.world.organization('borealis').id}&workspaceId=${h.app.world.workspace('borealis-hq').id}`,
      { utterance: HIRE },
    );
    expect([403, 404]).toContain(lena.statusCode);
    expect(await h.employees()).toHaveLength(0);
  });
});

describe('agent resume authority: an approval never executes on its own', () => {
  let harness: ScenarioApp | undefined;
  afterEach(async () => {
    await harness?.close();
    harness = undefined;
  });

  const T_EXPIRY = '2026-09-01T10:00:00.000Z';

  async function gated(options: Options = {}) {
    const base = buildBaseWorld();
    const world = extendWorld(base, 'resume', (w: WorldBuilder) => {
      let out = w.agent('hr-agent', {
        organization: 'aurora',
        workspace: 'aurora-eng',
        definition: 'hr',
        name: 'HR Agent',
        owner: 'meera',
        status: 'active',
      });
      for (const capability of HR_CAPS) {
        out = out.delegation(`d-${capability}`, {
          agent: 'hr-agent',
          grantedBy: 'meera',
          capability,
          ...(options.expiresAt === undefined ? {} : { expiresAt: options.expiresAt }),
        });
      }
      return out.policy('sod', {
        organization: 'aurora',
        policyId: AUTHORITY,
        config: { rules: SOD },
        createdBy: 'meera',
      });
    });
    const app = await createScenarioApp(world);
    harness = app;
    const org = app.world.organization('aurora').id;
    const ws = app.world.workspace('aurora-eng').id;
    const agent = (app.world.entity('hr-agent') as { id: string }).id;
    const scope = `organizationId=${org}&workspaceId=${ws}`;
    const run = await app.request('meera', 'POST', `/api/agents/${agent}/execute?${scope}`, {
      utterance: HIRE,
    });
    const approvalId =
      (run.json() as { outcome: { approvals: { id: string }[] } }).outcome.approvals[0]?.id ?? '';
    expect(approvalId).toMatch(/^apr_/);
    const employees = async () =>
      (await app.repos.employees.listByOrganization(org as never)).filter((employee) =>
        employee.name.value.includes('Sarah Agent'),
      );
    const decide = () =>
      app.request('vikram', 'POST', `/api/ai/approvals/${approvalId}/decision`, {
        decision: 'approve',
      });
    const audit = async () =>
      (
        (
          await app.request(
            'meera',
            'GET',
            `/api/audit/events?${scope}&source=activity&status=blocked`,
          )
        ).json() as { events: { detail?: string }[] }
      ).events
        .map((event) => event.detail ?? '')
        .join('\n');
    return { app, org, ws, agent, scope, employees, decide, audit, approvalId };
  }

  it('control: nothing changed between request and resume -> the hire happens', async () => {
    const h = await gated();
    expect((await h.decide()).body).toContain('"status":"completed"');
    expect(await h.employees()).toHaveLength(1);
  });

  it('delegation revoked after the gate opened, before the approval: NOT executed', async () => {
    const h = await gated();
    const delegations = await h.app.repos.agentDelegations!.listByAgent(h.org, h.agent);
    const composite = delegations.find((d) => d.capabilityId === COMPOSITE);
    const revoked = await h.app.request(
      'meera',
      'POST',
      `/api/agents/${h.agent}/delegations/${composite?.id}/revoke?${h.scope}`,
      {},
    );
    expect(revoked.statusCode).toBe(200);
    const response = await h.decide();
    expect(response.body).not.toContain('"status":"completed"');
    expect(await h.employees()).toHaveLength(0);
    expect(await h.audit()).toContain('DELEGATION_REVOKED');
  });

  it('inner delegation revoked (hr.create_employee): the composite cannot hire', async () => {
    const h = await gated();
    const delegations = await h.app.repos.agentDelegations!.listByAgent(h.org, h.agent);
    const inner = delegations.find((d) => d.capabilityId === 'hr.create_employee');
    await h.app.request(
      'meera',
      'POST',
      `/api/agents/${h.agent}/delegations/${inner?.id}/revoke?${h.scope}`,
      {},
    );
    const response = await h.decide();
    expect(response.body).not.toContain('"status":"completed"');
    expect(await h.employees()).toHaveLength(0);
  });

  it('delegation expired between gate and approval: NOT executed', async () => {
    const h = await gated({ expiresAt: T_EXPIRY });
    h.app.setAgentClock(new Date('2026-09-01T12:00:00.000Z'));
    const response = await h.decide();
    expect(response.body).not.toContain('"status":"completed"');
    expect(await h.employees()).toHaveLength(0);
    // Refused at resume: either the specific code, or the plan no longer binds the approval.
    expect(await h.audit()).toMatch(/DELEGATION_EXPIRED|APPROVAL_NOT_BOUND/);
  });

  it('agent suspended after the gate: NOT executed', async () => {
    const h = await gated();
    const suspended = await h.app.request(
      'meera',
      'POST',
      `/api/agents/${h.agent}/suspend?${h.scope}`,
      {},
    );
    expect(suspended.statusCode).toBe(200);
    expect((await h.decide()).body).not.toContain('"status":"completed"');
    expect(await h.employees()).toHaveLength(0);
    // Refused at resume: either the specific code, or the plan no longer binds the approval.
    expect(await h.audit()).toMatch(/AGENT_SUSPENDED|APPROVAL_NOT_BOUND/);
  });

  it('agent revoked after the gate: NOT executed', async () => {
    const h = await gated();
    const revoked = await h.app.request(
      'meera',
      'POST',
      `/api/agents/${h.agent}/revoke?${h.scope}`,
      {},
    );
    expect(revoked.statusCode).toBe(200);
    expect((await h.decide()).body).not.toContain('"status":"completed"');
    expect(await h.employees()).toHaveLength(0);
    // Refused at resume: either the specific code, or the plan no longer binds the approval.
    expect(await h.audit()).toMatch(/AGENT_REVOKED|APPROVAL_NOT_BOUND/);
  });

  it('requester lost the capability (demoted) after the gate: the decision is refused, NOT executed', async () => {
    const h = await gated();
    const meera = h.app.world.user('meera').id;
    const memberships = h.app.repos.workspaceMemberships;
    const current = await memberships.findByWorkspaceAndUser(h.ws as never, meera as never);
    expect(current).toBeDefined();
    await memberships.remove(current!);
    await memberships.save(
      WorkspaceMembership.create(
        { workspaceId: h.ws as never, userId: meera as never, role: 'member' },
        {
          actor: { kind: 'user', id: meera as never },
          correlationId: 'corr_demote',
          organizationId: h.org as never,
        },
      ),
    );
    const response = await h.decide();
    expect(response.statusCode).toBe(403);
    expect(await h.employees()).toHaveLength(0);
  });

  it('requester has NO executable capability at all (membership gone): still refused, an empty set is never unrestricted', async () => {
    const h = await gated();
    const meera = h.app.world.user('meera').id;
    const memberships = h.app.repos.workspaceMemberships;
    const current = await memberships.findByWorkspaceAndUser(h.ws as never, meera as never);
    await memberships.remove(current!);
    const orgMemberships = h.app.repos.memberships;
    for (const m of await orgMemberships.listByUser(meera as never)) {
      await orgMemberships.remove(m);
    }
    const response = await h.decide();
    expect(response.statusCode).toBe(403);
    expect(await h.employees()).toHaveLength(0);
  });
});
