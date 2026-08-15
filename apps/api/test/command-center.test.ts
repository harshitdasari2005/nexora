/**
 * S24 Phase 2 — Command Center API tests (`fastify.inject`).
 *
 * `GET /api/command-center` resolves the caller's Command Center from
 * TRUSTED context only: the tenant from authenticated membership, the
 * optional workspace verified against membership, and the effective
 * business role from membership (owner → executive.ceo, admin →
 * delivery.manager, member → technology.developer). Role/domain claims are
 * ignored; forged scopes resolve to 403; widget data stays tenant/workspace
 * scoped through the existing application services.
 */

import { describe, expect, it } from 'vitest';
import type {
  CommandCenterDto,
  CommandCenterEntryDto,
  CommandCenterWidgetDataDto,
} from '@nexora/contracts/command-center';
import type { TenantId } from '@nexora/contracts/common';

import {
  chatClient,
  currentUserId,
  onboardOrgAndWorkspace,
  seedKnowledgeArticle,
  seedProject,
  seedWorkspace,
  seedWorkspaceMembership,
  type ChatClient,
} from './helpers.js';
import { seedDocumentAndKnowledge } from './helpers.js';

/** Asserts widget data is a list and returns its items (typed narrowing). */
function listItems(data: CommandCenterWidgetDataDto | undefined): readonly CommandCenterEntryDto[] {
  expect(data).toBeDefined();
  expect(data?.kind).toBe('list');
  if (data === undefined || data.kind !== 'list') {
    return [];
  }
  return data.items;
}

/** Seeds a workspace the user is a member of with the given role. */
async function seedMemberWorkspace(
  client: ChatClient,
  organizationId: string,
  role: 'owner' | 'admin' | 'member',
): Promise<string> {
  const workspaceId = `wsp_role_${role}`;
  await seedWorkspace(client.repos, {
    id: workspaceId,
    organizationId,
    slug: `role-${role}`, // slugs are lowercase alphanumeric + dashes
  });
  await seedWorkspaceMembership(client.repos, {
    workspaceId,
    userId: currentUserId(client),
    role,
    organizationId,
  });
  return workspaceId;
}

describe('GET /api/command-center', () => {
  it('rejects unauthenticated access with 401', async () => {
    const client = await chatClient();
    const response = await client.app.inject({ method: 'GET', url: '/api/command-center' });
    expect(response.statusCode).toBe(401);
  });

  it('resolves the CEO command center for an owner from trusted membership', async () => {
    const client = await chatClient();
    const { organizationId, workspaceId } = await onboardOrgAndWorkspace(client);

    // Real persisted data: seed a measurement snapshot so the KPI widgets
    // render actual tenant numbers (never fabricated values).
    // The fake repository exposes `seed` (not part of the MeasurementRepository
    // port — test-only convenience, cast through unknown).
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
        users: 3,
        workspaces: 2,
        projects: 7,
        documents: 0,
        knowledgeSources: 0,
        calendarEvents: 0,
      },
    });

    const response = await client.get(
      `/api/command-center?organizationId=${organizationId}&workspaceId=${workspaceId}`,
    );
    expect(response.statusCode).toBe(200);
    const center = response.json() as CommandCenterDto;

    // The owner resolves to the CEO center — trusted server-side resolution.
    expect(center.id).toBe('ceo');
    expect(center.domainId).toBe('executive');
    expect(center.roleId).toBe('executive.ceo');
    expect(center.roleName).toBe('CEO');
    expect(center.domainName).toBe('Executive');
    expect(center.actions.length).toBeGreaterThan(0);
    expect(center.actions.every((action) => action.kind === 'navigate')).toBe(true);

    // Real tenant measurement data flows into the KPI and health widgets.
    expect(center.data.projects_kpi).toEqual({
      kind: 'kpi',
      value: '7',
      hint: 'Projects across the tenant',
    });
    const health = listItems(center.data.workflow_health);
    expect(health.map((item) => item.title)).toContain('employee-onboarding');
  });

  it('ignores forged role and domain claims — the trusted role wins', async () => {
    const client = await chatClient();
    const { organizationId, workspaceId } = await onboardOrgAndWorkspace(client);

    const response = await client.get(
      `/api/command-center?organizationId=${organizationId}&workspaceId=${workspaceId}&role=technology.developer&domain=technology`,
    );
    expect(response.statusCode).toBe(200);
    const center = response.json() as CommandCenterDto;
    // The owner is a CEO regardless of the forged role/domain parameters.
    expect(center.id).toBe('ceo');
    expect(center.roleId).toBe('executive.ceo');
  });

  it('resolves the Manager command center for an admin workspace member', async () => {
    const client = await chatClient();
    const { organizationId } = await onboardOrgAndWorkspace(client);
    const workspaceId = await seedMemberWorkspace(client, organizationId, 'admin');

    // Real data: seed projects + employees the manager widget lists.
    await seedProject(client.repos, {
      id: 'prj_alpha',
      organizationId,
      name: 'Alpha Platform',
      status: 'active',
    });
    await seedProject(client.repos, {
      id: 'prj_beta',
      organizationId,
      name: 'Beta Service',
      status: 'on_hold',
    });

    const response = await client.get(
      `/api/command-center?organizationId=${organizationId}&workspaceId=${workspaceId}`,
    );
    expect(response.statusCode).toBe(200);
    const center = response.json() as CommandCenterDto;
    expect(center.id).toBe('manager');
    expect(center.roleId).toBe('delivery.manager');

    // The projects list widget renders real persisted project data.
    const projects = listItems(center.data.projects);
    const titles = projects.map((item) => item.title);
    expect(titles).toContain('Alpha Platform');
    expect(titles).toContain('Beta Service');
  });

  it('resolves the Developer command center for a member workspace', async () => {
    const client = await chatClient();
    const { organizationId } = await onboardOrgAndWorkspace(client);
    const workspaceId = await seedMemberWorkspace(client, organizationId, 'member');

    // Real, workspace-scoped data: a document and a knowledge article in
    // THIS workspace; a document in another workspace the user is not a
    // member of (must never leak into the developer center).
    await seedDocumentAndKnowledge(client.repos, {
      id: 'doc_sprint',
      organizationId,
      workspaceId,
      uploaderId: currentUserId(client),
      title: 'Sprint Notes',
      text: 'Sprint planning notes.',
    });
    await seedKnowledgeArticle(client.repos, {
      id: 'art_onboarding',
      organizationId,
      workspaceId,
      author: currentUserId(client),
      title: 'Onboarding Guide',
      body: 'How to get started.',
      status: 'published',
    });
    await seedWorkspace(client.repos, {
      id: 'wsp_foreign_docs',
      organizationId,
      slug: 'foreign-docs',
    });
    await seedDocumentAndKnowledge(client.repos, {
      id: 'doc_confidential',
      organizationId,
      workspaceId: 'wsp_foreign_docs',
      uploaderId: currentUserId(client),
      title: 'Confidential Memo',
      text: 'Must not leak.',
    });

    const response = await client.get(
      `/api/command-center?organizationId=${organizationId}&workspaceId=${workspaceId}`,
    );
    expect(response.statusCode).toBe(200);
    const center = response.json() as CommandCenterDto;
    expect(center.id).toBe('developer');
    expect(center.roleId).toBe('technology.developer');

    // Documents are workspace-scoped: only THIS workspace's document shows.
    const documents = listItems(center.data.documents);
    const titles = documents.map((item) => item.title);
    expect(titles).toContain('Sprint Notes');
    expect(titles).not.toContain('Confidential Memo');
    // Knowledge articles are workspace-scoped too.
    const knowledge = listItems(center.data.knowledge);
    expect(knowledge.map((item) => item.title)).toContain('Onboarding Guide');
  });

  it('rejects a forged workspace the user is not a member of with 403', async () => {
    const client = await chatClient();
    const { organizationId } = await onboardOrgAndWorkspace(client);
    // A workspace exists in the same org but the user has no membership.
    await seedWorkspace(client.repos, {
      id: 'wsp_alien',
      organizationId,
      slug: 'alien-workspace',
    });

    const response = await client.get(
      `/api/command-center?organizationId=${organizationId}&workspaceId=wsp_alien`,
    );
    expect(response.statusCode).toBe(403);
  });

  it('never returns cross-tenant data: foreign projects stay out of the centers', async () => {
    const client = await chatClient();
    const { organizationId } = await onboardOrgAndWorkspace(client);
    const workspaceId = await seedMemberWorkspace(client, organizationId, 'admin');

    // A project in a FOREIGN tenant (the user has no membership there).
    await seedProject(client.repos, {
      id: 'prj_alien',
      organizationId: 'org_alien',
      name: 'Alien Secret Project',
      status: 'active',
    });

    const response = await client.get(
      `/api/command-center?organizationId=${organizationId}&workspaceId=${workspaceId}`,
    );
    expect(response.statusCode).toBe(200);
    const center = response.json() as CommandCenterDto;
    const projects = listItems(center.data.projects);
    expect(projects.map((item) => item.title)).not.toContain('Alien Secret Project');
  });

  it('resolves the tenant from trusted membership even when a forged organizationId is passed', async () => {
    const client = await chatClient();
    const { workspaceId } = await onboardOrgAndWorkspace(client);

    // The user is not a member of `org_alien`; the route must resolve the
    // tenant from TRUSTED membership (falling back to the user's own org),
    // never to foreign data.
    const response = await client.get(
      `/api/command-center?organizationId=org_alien&workspaceId=${workspaceId}`,
    );
    expect(response.statusCode).toBe(200);
    const center = response.json() as CommandCenterDto;
    expect(center.id).toBe('ceo');
    expect(center.domainId).toBe('executive');
    // And the resolved tenant is the user's own organization, not the
    // forged one — asserted by the role the user actually holds.
    expect(center.roleId).toBe('executive.ceo');
  });

  it('renders honest empty states when no data exists', async () => {
    const client = await chatClient();
    const { organizationId } = await onboardOrgAndWorkspace(client);
    const workspaceId = await seedMemberWorkspace(client, organizationId, 'member');

    const response = await client.get(
      `/api/command-center?organizationId=${organizationId}&workspaceId=${workspaceId}`,
    );
    expect(response.statusCode).toBe(200);
    const center = response.json() as CommandCenterDto;
    // No documents/articles seeded: the lists are empty, never fabricated.
    const documents = listItems(center.data.documents);
    expect(documents).toEqual([]);
    const attention = center.data.attention;
    expect(attention?.kind).toBe('attention');
    if (attention !== undefined && attention.kind === 'attention') {
      expect(attention.items).toEqual([]);
    }
  });
});
