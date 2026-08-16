/**
 * S26 Phase 8 — Business Agent API tests (`fastify.inject`).
 *
 * `GET /api/agent` resolves the caller's governed business agent from
 * TRUSTED context only: the tenant from authenticated membership, the
 * optional workspace verified against membership, and the effective
 * business role from membership (owner → executive.ceo → Executive Agent,
 * admin → delivery.manager → Manager Agent, member → technology.developer →
 * Developer Agent). Role/domain/agentId claims are ignored; forged scopes
 * resolve to 403; governed proposals are derived from REAL persisted data
 * through the existing application services (never fabricated) and stay
 * tenant-scoped.
 */

import { describe, expect, it } from 'vitest';
import type { BusinessAgentDto } from '@nexora/contracts/agent';
import type { TenantId } from '@nexora/contracts/common';

import {
  chatClient,
  currentUserId,
  onboardOrgAndWorkspace,
  seedProject,
  seedWorkspace,
  seedWorkspaceMembership,
  type ChatClient,
} from './helpers.js';

/** Seeds a workspace the user is a member of with the given role. */
async function seedMemberWorkspace(
  client: ChatClient,
  organizationId: string,
  role: 'owner' | 'admin' | 'member',
): Promise<string> {
  const workspaceId = `wsp_agent_${role}`;
  await seedWorkspace(client.repos, {
    id: workspaceId,
    organizationId,
    slug: `agent-role-${role}`,
  });
  await seedWorkspaceMembership(client.repos, {
    workspaceId,
    userId: currentUserId(client),
    role,
    organizationId,
  });
  return workspaceId;
}

/** Seeds a tenant measurement snapshot with a failing workflow (real state). */
function seedFailingWorkflowMeasurements(client: ChatClient, organizationId: string): void {
  (
    client.repos.measurements as unknown as {
      seed: (
        t: TenantId,
        s: {
          tenantId: string;
          generatedAt: string;
          workflowHealth: unknown[];
          onboarding: unknown[];
          auditCompleteness: unknown;
          overview: {
            users: number;
            workspaces: number;
            projects: number;
            documents: number;
            knowledgeSources: number;
            calendarEvents: number;
          };
        },
      ) => void;
    }
  ).seed(organizationId as TenantId, {
    tenantId: organizationId,
    generatedAt: '2026-08-15T00:00:00.000Z',
    workflowHealth: [
      {
        definitionKey: 'employee-onboarding',
        total: 4,
        succeeded: 3,
        failed: 1,
        successRate: 75,
        unrecoverableErrorRate: 25,
        cycleTimeP50Ms: 12_000,
        cycleTimeP95Ms: 40_000,
      },
    ],
    onboarding: [],
    auditCompleteness: {
      traceableShare: 100,
      totalEvents: 0,
      tracedEvents: 0,
      untracedTypes: [],
    },
    overview: {
      users: 1,
      workspaces: 1,
      projects: 0,
      documents: 0,
      knowledgeSources: 0,
      calendarEvents: 0,
    },
  });
}

describe('GET /api/agent', () => {
  it('rejects unauthenticated access with 401', async () => {
    const client = await chatClient();
    const response = await client.app.inject({ method: 'GET', url: '/api/agent' });
    expect(response.statusCode).toBe(401);
  });

  it('resolves the Executive Agent for an owner from trusted membership', async () => {
    const client = await chatClient();
    const { organizationId, workspaceId } = await onboardOrgAndWorkspace(client);

    const response = await client.get(
      `/api/agent?organizationId=${organizationId}&workspaceId=${workspaceId}`,
    );
    expect(response.statusCode).toBe(200);
    const agent = response.json() as BusinessAgentDto;

    // The owner resolves to the Executive Agent — trusted server-side
    // resolution from the SAME membership seam as the Command Center.
    expect(agent.id).toBe('executive');
    expect(agent.domainId).toBe('executive');
    expect(agent.roleId).toBe('executive.ceo');
    expect(agent.roleName).toBe('CEO');
    expect(agent.domainName).toBe('Executive');
    expect(agent.autonomyLevel).toBe('governed_execution');

    // The capability set is the agent's registered executable AI
    // capabilities (Phase 3 bridge vocabulary).
    const capabilityIds = agent.capabilities.map((c) => c.id);
    expect(capabilityIds).toContain('projects.find_project');
    expect(capabilityIds).toContain('notifications.what_needs_attention');

    // Goals and policies are part of the definition.
    expect(agent.goals.length).toBeGreaterThan(0);
    expect(agent.policies.some((p) => p.id === 'writes.require_approval')).toBe(true);

    // No workspace-scoped data: proposals are honestly empty.
    expect(agent.proposals).toEqual([]);
  });

  it('ignores forged role and domain claims — the trusted role wins', async () => {
    const client = await chatClient();
    const { organizationId, workspaceId } = await onboardOrgAndWorkspace(client);

    const response = await client.get(
      `/api/agent?organizationId=${organizationId}&workspaceId=${workspaceId}&role=technology.developer&domain=technology&agentId=developer`,
    );
    expect(response.statusCode).toBe(200);
    const agent = response.json() as BusinessAgentDto;
    // The owner is an Executive Agent regardless of the forged parameters.
    expect(agent.id).toBe('executive');
    expect(agent.roleId).toBe('executive.ceo');
  });

  it('resolves the Manager Agent for an admin workspace member', async () => {
    const client = await chatClient();
    const { organizationId } = await onboardOrgAndWorkspace(client);
    const workspaceId = await seedMemberWorkspace(client, organizationId, 'admin');

    const response = await client.get(
      `/api/agent?organizationId=${organizationId}&workspaceId=${workspaceId}`,
    );
    expect(response.statusCode).toBe(200);
    const agent = response.json() as BusinessAgentDto;
    expect(agent.id).toBe('manager');
    expect(agent.domainId).toBe('delivery');
    expect(agent.roleId).toBe('delivery.manager');
    expect(agent.roleName).toBe('Manager');
  });

  it('resolves the Developer Agent for a member workspace member', async () => {
    const client = await chatClient();
    const { organizationId } = await onboardOrgAndWorkspace(client);
    const workspaceId = await seedMemberWorkspace(client, organizationId, 'member');

    const response = await client.get(
      `/api/agent?organizationId=${organizationId}&workspaceId=${workspaceId}`,
    );
    expect(response.statusCode).toBe(200);
    const agent = response.json() as BusinessAgentDto;
    expect(agent.id).toBe('developer');
    expect(agent.domainId).toBe('technology');
    expect(agent.roleId).toBe('technology.developer');
    expect(agent.roleName).toBe('Developer');

    // The Developer agent has no Slack surface (its policy is part of the
    // definition, never inferred).
    expect(agent.policies.some((p) => p.id === 'no.slack')).toBe(true);
    const capabilityIds = agent.capabilities.map((c) => c.id);
    expect(capabilityIds).not.toContain('slack.messages.send');
  });

  it('derives governed proposals from real persisted tenant data', async () => {
    const client = await chatClient();
    const { organizationId } = await onboardOrgAndWorkspace(client);

    // Real persisted data at the tenant scope: projects produce a project
    // proposal; their `project.created` events produce unread notifications
    // (attention proposal) and activity items (activity proposal). A
    // measurement snapshot with a failing workflow produces a health
    // proposal — every proposal references real persisted state.
    await client.post('/api/projects', {
      organizationId,
      name: 'Mobile Banking',
      description: 'Core banking platform',
    });
    await client.post('/api/projects', {
      organizationId,
      name: 'Loyalty Engine',
      description: 'Rewards platform',
    });
    seedFailingWorkflowMeasurements(client, organizationId);

    const response = await client.get(`/api/agent?organizationId=${organizationId}`);
    expect(response.statusCode).toBe(200);
    const agent = response.json() as BusinessAgentDto;
    expect(agent.id).toBe('executive');

    const proposalIds = agent.proposals.map((p) => p.id);
    expect(proposalIds).toContain('propose_review_projects');
    expect(proposalIds).toContain('propose_review_attention');
    expect(proposalIds).toContain('propose_review_activity');
    expect(proposalIds).toContain('propose_inspect_workflow_health');

    // The project proposal references a REAL project of the tenant.
    const projectProposal = agent.proposals.find((p) => p.id === 'propose_review_projects');
    expect(projectProposal?.requiredCapability).toBe('projects.find_project');
    expect(projectProposal?.requiresApproval).toBe(false);
    expect(projectProposal?.reason).toMatch(/Mobile Banking|Loyalty Engine/);

    // The attention proposal counts real unread notifications (2 projects).
    const attentionProposal = agent.proposals.find((p) => p.id === 'propose_review_attention');
    expect(attentionProposal?.reason).toContain('2');

    // The health proposal names the real failing workflow definition.
    const healthProposal = agent.proposals.find((p) => p.id === 'propose_inspect_workflow_health');
    expect(healthProposal?.reason).toContain('employee-onboarding');
    expect(healthProposal?.affectedEntity?.id).toBe('employee-onboarding');
  });

  it('rejects a forged workspace the user is not a member of with 403', async () => {
    const client = await chatClient();
    const { organizationId } = await onboardOrgAndWorkspace(client);
    // A workspace exists in the same org but the user has no membership.
    await seedWorkspace(client.repos, {
      id: 'wsp_agent_alien',
      organizationId,
      slug: 'agent-alien-workspace',
    });

    const response = await client.get(
      `/api/agent?organizationId=${organizationId}&workspaceId=wsp_agent_alien`,
    );
    expect(response.statusCode).toBe(403);
  });

  it('never proposes cross-tenant data: foreign projects stay out of the agent proposals', async () => {
    const client = await chatClient();
    const { organizationId } = await onboardOrgAndWorkspace(client);

    // A project in a FOREIGN tenant (the user has no membership there).
    await seedProject(client.repos, {
      id: 'prj_agent_alien',
      organizationId: 'org_alien',
      name: 'Alien Secret Project',
      status: 'active',
    });
    await client.post('/api/projects', { organizationId, name: 'Mobile Banking' });

    const response = await client.get(`/api/agent?organizationId=${organizationId}`);
    expect(response.statusCode).toBe(200);
    const agent = response.json() as BusinessAgentDto;
    const reasons = agent.proposals.map((p) => p.reason).join(' ');
    expect(reasons).not.toContain('Alien Secret Project');
  });

  it('resolves the tenant from trusted membership even when a forged organizationId is passed', async () => {
    const client = await chatClient();
    const { workspaceId } = await onboardOrgAndWorkspace(client);

    // The user is not a member of `org_alien`; the route must resolve the
    // tenant from TRUSTED membership (falling back to the user's own org),
    // never to foreign data.
    const response = await client.get(
      `/api/agent?organizationId=org_alien&workspaceId=${workspaceId}`,
    );
    expect(response.statusCode).toBe(200);
    const agent = response.json() as BusinessAgentDto;
    expect(agent.id).toBe('executive');
    expect(agent.roleId).toBe('executive.ceo');
  });

  it('renders honest empty proposals when no data exists', async () => {
    const client = await chatClient();
    const { organizationId } = await onboardOrgAndWorkspace(client);

    const response = await client.get(`/api/agent?organizationId=${organizationId}`);
    expect(response.statusCode).toBe(200);
    const agent = response.json() as BusinessAgentDto;
    // No projects, notifications, activity, or failing workflows: the agent
    // has nothing to propose — never fabricated.
    expect(agent.proposals).toEqual([]);
  });
});
