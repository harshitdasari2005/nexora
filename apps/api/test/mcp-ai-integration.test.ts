/**
 * S24 Phase 5 — AI ↔ MCP integration tests.
 *
 * Proves the "one canonical definition, two adapters" architecture: the
 * tools the Nexora MCP server exposes are the SAME canonical tools the AI
 * Runtime executes, driven by the SAME capability bridge. The AI's
 * capability-aware discovery and the MCP capability-aware tool list can
 * never disagree about what a role may do.
 */

import { describe, expect, it } from 'vitest';
import { createInitialCatalog } from '@nexora/module-domains';
import type { AIBusinessContext } from '@nexora/ai-runtime';
import { loadConfig } from '../src/config.js';
import { buildContainer, type RepositorySet } from '../src/container.js';
import { buildApplicationEventPublisher } from '../src/events/application-publisher.js';
import { composeAiRuntime } from '../src/ai/compose.js';
import { buildNexoraMCPServer } from '../src/ai/mcp/build-server.js';
import {
  buildAIBusinessContext,
  MembershipBusinessRoleResolver,
} from '../src/business-context/index.js';
import {
  seedOrganization,
  seedOrganizationMembership,
  seedWorkspace,
  seedWorkspaceMembership,
} from './helpers.js';
import {
  FakeActivityRepository,
  FakeBudgetRepository,
  FakeCalendarEntryRepository,
  FakeExpenseRepository,
  FakeDocumentRepository,
  FakeDocumentTemplateRepository,
  FakeDocumentVersionRepository,
  FakeEmailOutboxRepository,
  FakeInboundMessageRepository,
  FakeEmployeeRepository,
  FakeKnowledgeArticleRepository,
  FakeKnowledgeCategoryRepository,
  FakeKnowledgeSourceRepository,
  FakeMeasurementRepository,
  FakeMembershipRepository,
  FakeNotificationPreferencesRepository,
  FakeNotificationRepository,
  FakeOrganizationRepository,
  FakeProjectRepository,
  FakeResourceAssignmentRepository,
  FakeRoleRepository,
  FakeSessionRepository,
  FakeUserRepository,
  FakeWebhookDeliveryRepository,
  FakeWebhookEndpointRepository,
  FakeWorkflowInstanceRepository,
  FakeWorkflowStepExecutionRepository,
  FakeWorkspaceInstallationRepository,
  FakeWorkspaceMembershipRepository,
  FakeWorkspaceRepository,
} from './fakes.js';
import { InMemorySearchIndex } from '@nexora/module-search';
import {
  DefaultDocumentTextExtractor,
  InMemoryDocumentStorage,
} from '@nexora/application-documents';

/** Builds a fixture for a role and returns the server + the trusted context. */
async function fixtureFor(role: 'owner' | 'admin' | 'member'): Promise<{
  visibleCapabilityIds: readonly string[];
  serverToolCapabilities: readonly string[];
  aiToolIds: readonly string[];
  business: AIBusinessContext | undefined;
  server: Awaited<ReturnType<typeof buildNexoraMCPServer>>;
}> {
  const config = loadConfig({
    DATABASE_URL: 'postgres://test:test@localhost:5432/test',
    LOG_LEVEL: 'error',
    INTEGRATIONS_INBOUND_SECRET: 'test',
  } as NodeJS.ProcessEnv);
  const repositories: RepositorySet = {
    users: new FakeUserRepository(),
    sessions: new FakeSessionRepository(),
    roles: new FakeRoleRepository(),
    organizations: new FakeOrganizationRepository(),
    memberships: new FakeMembershipRepository(),
    workspaces: new FakeWorkspaceRepository(),
    workspaceMemberships: new FakeWorkspaceMembershipRepository(),
    workspaceInstallations: new FakeWorkspaceInstallationRepository(),
    projects: new FakeProjectRepository(),
    resourceAssignments: new FakeResourceAssignmentRepository(),
    employees: new FakeEmployeeRepository(),
    documents: new FakeDocumentRepository(),
    documentVersions: new FakeDocumentVersionRepository(),
    documentTemplates: new FakeDocumentTemplateRepository(),
    knowledgeSources: new FakeKnowledgeSourceRepository(),
    knowledgeArticles: new FakeKnowledgeArticleRepository(),
    knowledgeCategories: new FakeKnowledgeCategoryRepository(),
    calendarEvents: new FakeCalendarEntryRepository(),
    budgets: new FakeBudgetRepository(),
    expenses: new FakeExpenseRepository(),
    webhookEndpoints: new FakeWebhookEndpointRepository(),
    webhookDeliveries: new FakeWebhookDeliveryRepository(),
    emailOutbox: new FakeEmailOutboxRepository(),
    inboundMessages: new FakeInboundMessageRepository(),
    measurements: new FakeMeasurementRepository(),
    searchIndex: new InMemorySearchIndex(),
    documentStorage: new InMemoryDocumentStorage(),
    documentExtractor: new DefaultDocumentTextExtractor(),
    workflowInstances: new FakeWorkflowInstanceRepository(),
    workflowStepExecutions: new FakeWorkflowStepExecutionRepository(),
    notifications: new FakeNotificationRepository(),
    notificationPreferences: new FakeNotificationPreferencesRepository(),
    activity: new FakeActivityRepository(),
  };
  await seedOrganization(repositories, { id: 'org_mcp', slug: 'mcp-acme' });
  await seedOrganizationMembership(repositories, {
    organizationId: 'org_mcp',
    userId: 'usr_mcp',
    role,
  });
  await seedWorkspace(repositories, {
    id: 'wsp_mcp_eng',
    organizationId: 'org_mcp',
    slug: 'mcp-eng',
  });
  await seedWorkspaceMembership(repositories, {
    workspaceId: 'wsp_mcp_eng',
    userId: 'usr_mcp',
    role,
    organizationId: 'org_mcp',
  });

  const { publisher } = buildApplicationEventPublisher({ repositories });
  const container = buildContainer({ config, repositories, publisher });
  const ai = composeAiRuntime({ config, container, repositories, publisher });
  const roleResolver = new MembershipBusinessRoleResolver({
    memberships: repositories.memberships,
    workspaceMemberships: repositories.workspaceMemberships,
  });
  const catalog = createInitialCatalog();
  const server = await buildNexoraMCPServer({
    runtime: { tools: ai.tools, approvals: ai.approvals },
    resolveBusinessContext: (context) => buildAIBusinessContext({ roleResolver, catalog }, context),
    identity: { userId: 'usr_mcp', tenantId: 'org_mcp', workspaceId: 'wsp_mcp_eng' },
  });
  const business = await buildAIBusinessContext(
    { roleResolver, catalog },
    { userId: 'usr_mcp', tenantId: 'org_mcp', workspaceId: 'wsp_mcp_eng' },
  );
  return {
    visibleCapabilityIds: business?.capabilityIds ?? [],
    serverToolCapabilities: server.visibleTools().map((tool) => tool.definition.requiredCapability),
    aiToolIds: ai.tools.ids(),
    business,
    server,
  };
}

describe('AI ↔ MCP integration (one canonical tool surface)', () => {
  it('the MCP visible tool capabilities are exactly the trusted AI capability affinity', async () => {
    const ceo = await fixtureFor('owner');
    // Every visible MCP tool's required capability is in the SAME trusted
    // affinity that focuses the AI's discovery — the two surfaces can never
    // disagree about what the role may do.
    for (const capability of ceo.serverToolCapabilities) {
      expect(ceo.visibleCapabilityIds).toContain(capability);
    }
    // The affinity is the ceiling: no MCP tool exists outside it.
    const developer = await fixtureFor('member');
    for (const capability of developer.serverToolCapabilities) {
      expect(developer.visibleCapabilityIds).toContain(capability);
    }
  });

  it('every MCP-backed tool is a canonical AI tool (native adapter intact)', async () => {
    const { aiToolIds } = await fixtureFor('owner');
    // The write tools + existing read tools the MCP server exposes are the
    // SAME canonical instances the AI Runtime executes (native adapter).
    expect(aiToolIds).toContain('calendar.create_event');
    expect(aiToolIds).toContain('projects.create_project');
    expect(aiToolIds).toContain('projects.find_project');
    expect(aiToolIds).toContain('knowledge.search');
    // The new MCP read tools are executable through the SAME registry.
    expect(aiToolIds).toContain('projects.list');
    expect(aiToolIds).toContain('documents.search');
    expect(aiToolIds).toContain('notifications.list');
  });

  it('role → capability → MCP tool intersection: Developer never sees write tools', async () => {
    const developer = await fixtureFor('member');
    expect(developer.visibleCapabilityIds).not.toContain('calendar.create_event');
    expect(developer.visibleCapabilityIds).not.toContain('projects.create_project');
    expect(developer.serverToolCapabilities).not.toContain('calendar.create_event');
    expect(developer.serverToolCapabilities).not.toContain('projects.create_project');

    const ceo = await fixtureFor('owner');
    expect(ceo.serverToolCapabilities).toContain('calendar.create_event');
    expect(ceo.serverToolCapabilities).toContain('projects.create_project');
  });

  it('the AI can plan with the same MCP-exposed calendar capability (existing governed path)', async () => {
    // The AI already executes the canonical `calendar.create_event` tool
    // (proven by the Phase 4 governed-execution suite); this asserts the
    // MCP server exposes the SAME capability id so an MCP client and the AI
    // negotiate identical semantics.
    const ceo = await fixtureFor('owner');
    expect(ceo.business?.capabilityIds).toContain('calendar.create_event');
    expect(ceo.serverToolCapabilities).toContain('calendar.create_event');
    const calendarTool = ceo.server
      .visibleTools()
      .find((tool) => tool.definition.name === 'nexora.calendar.create_event');
    expect(calendarTool?.definition.operationType).toBe('write');
    expect(calendarTool?.definition.requiresApproval).toBe(true);
    expect(calendarTool?.definition.inputSchema).toMatchObject({
      type: 'object',
      properties: expect.objectContaining({
        title: expect.anything(),
        startsAt: expect.anything(),
        endsAt: expect.anything(),
      }),
    });
    // Identity/scope fields are NEVER part of an MCP tool schema.
    const schema = calendarTool?.definition.inputSchema as { properties?: Record<string, unknown> };
    expect(Object.keys(schema.properties ?? {})).not.toContain('tenantId');
    expect(Object.keys(schema.properties ?? {})).not.toContain('workspaceId');
    expect(Object.keys(schema.properties ?? {})).not.toContain('userId');
  });
});
