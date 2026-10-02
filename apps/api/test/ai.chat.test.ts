/**
 * AI vertical slice E2E at the API boundary (`fastify.inject`): authenticate
 * → create organization → create workspace → chat with the Enterprise AI →
 * the AI discovers the ListWorkspacesTool, executes it through the
 * workspaces application layer, and streams the result back. Conversations
 * are persisted through the injected conversation store. Security-specific
 * regression cases live in ./ai.security.test.ts (shared harness in
 * ./helpers.ts).
 */

import { describe, expect, it } from 'vitest';

import { loadConfig } from '../src/config.js';
import { buildApp } from '../src/app.js';
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
  FakeMeasurementRepository,
  FakeEmployeeRepository,
  FakeCandidateRepository,
  FakeHiringRequisitionRepository,
  FakeJobOpeningRepository,
  FakeKnowledgeArticleRepository,
  FakeKnowledgeCategoryRepository,
  FakeKnowledgeSourceRepository,
  FakeMembershipRepository,
  FakeNotificationPreferencesRepository,
  FakeNotificationRepository,
  FakeOidcGateway,
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
import {
  DefaultDocumentTextExtractor,
  InMemoryDocumentStorage,
} from '@nexora/application-documents';
import { InMemorySearchIndex } from '@nexora/module-search';
import type { RepositorySet } from '../src/container.js';
import { chatClient, onboardOrgAndWorkspace, parseSse } from './helpers.js';

describe('AI chat slice (E2E via inject)', () => {
  it('discovers ListWorkspacesTool, executes it, and streams the result', async () => {
    const client = await chatClient();
    const { workspaceId, workspaceSlug } = await onboardOrgAndWorkspace(client);

    const chat = await client.post('/api/ai/chat', {
      message: 'What workspaces do I have?',
      workspaceId,
    });

    expect(chat.statusCode).toBe(200);
    expect(chat.headers['content-type']).toContain('text/event-stream');

    const events = parseSse(chat.body as string);
    const names = events.map((event) => event.event);
    expect(names).toEqual(expect.arrayContaining(['meta', 'delta', 'done']));

    const meta = events.find((event) => event.event === 'meta');
    expect(meta?.data).toMatchObject({
      runId: expect.any(String),
      conversationId: expect.any(String),
    });

    // The deterministic narration reports the executed capability and the
    // tool output (the workspace itself).
    const done = events.find((event) => event.event === 'done');
    expect(done?.data).toMatchObject({
      status: 'completed',
      conversationId: expect.any(String),
    });
    const donePayload = done?.data as { response: string; steps: { status: string }[] };
    expect(donePayload.response).toContain('workspaces.list_workspaces');
    expect(donePayload.response).toContain(workspaceSlug);
    expect(donePayload.steps[0]).toMatchObject({
      capabilityId: 'workspaces.list_workspaces',
      toolId: 'workspaces.list_workspaces',
      status: 'succeeded',
    });

    // The conversation is persisted: user turn + assistant turn, with the
    // tenant and workspace scope.
    const conversationId = (meta?.data as { conversationId: string }).conversationId;
    const conversation = await client.store.load(conversationId);
    expect(conversation).toBeDefined();
    expect(conversation?.workspaceId).toBe(workspaceId);
    expect(conversation?.turns).toHaveLength(2);
    expect(conversation?.turns[0]).toMatchObject({
      role: 'user',
      content: 'What workspaces do I have?',
    });
    expect(conversation?.turns[1]).toMatchObject({ role: 'assistant' });
    expect(conversation?.turns[1]?.content).toContain(workspaceSlug);

    await client.app.close();
  });

  it('continues a conversation by conversation id', async () => {
    const client = await chatClient();
    const { workspaceId } = await onboardOrgAndWorkspace(client);

    const first = await client.post('/api/ai/chat', {
      message: 'What workspaces do I have?',
      workspaceId,
    });
    const firstMeta = parseSse(first.body as string).find((event) => event.event === 'meta');
    const conversationId = (firstMeta?.data as { conversationId: string }).conversationId;

    const second = await client.post('/api/ai/chat', {
      message: 'List them again',
      workspaceId,
      conversationId,
    });
    const secondMeta = parseSse(second.body as string).find((event) => event.event === 'meta');
    expect((secondMeta?.data as { conversationId: string }).conversationId).toBe(conversationId);

    const conversation = await client.store.load(conversationId);
    expect(conversation?.turns).toHaveLength(4);
    await client.app.close();
  });

  it('rejects unauthenticated chat with 401', async () => {
    const config = loadConfig({
      DATABASE_URL: 'postgres://test:test@localhost:5432/test',
      LOG_LEVEL: 'error',
      INTEGRATIONS_INBOUND_SECRET: 'test-inbound-secret',
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
      hiringRequisitions: new FakeHiringRequisitionRepository(),
      jobOpenings: new FakeJobOpeningRepository(),
      candidates: new FakeCandidateRepository(),
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
    const app = await buildApp({ config, oidc: new FakeOidcGateway(), repositories });
    const response = await app.inject({
      method: 'POST',
      url: '/api/ai/chat',
      headers: { 'content-type': 'application/json' },
      payload: { message: 'hi' },
    });
    expect(response.statusCode).toBe(401);
    await app.close();
  });

  it('rejects chat without an organization with 400', async () => {
    const client = await chatClient();
    const response = await client.post('/api/ai/chat', { message: 'hi' });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ error: { code: 'VALIDATION_ERROR' } });
    await client.app.close();
  });

  it('rejects a workspace outside the caller organization with 403', async () => {
    const client = await chatClient();
    // The caller belongs to an organization, but not to `wsp_alien`.
    await client.post('/api/organizations', {
      name: 'Acme Inc.',
      slug: 'acme',
      type: 'startup',
    });
    const response = await client.post('/api/ai/chat', {
      message: 'hi',
      workspaceId: 'wsp_alien',
    });
    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({ error: { code: 'AUTHORIZATION_ERROR' } });
    await client.app.close();
  });

  it('rejects an empty message with 400 (schema validation)', async () => {
    const client = await chatClient();
    const response = await client.post('/api/ai/chat', { message: '   ' });
    expect(response.statusCode).toBe(400);
    await client.app.close();
  });

  it('clarifies when no capability matches the intent', async () => {
    const client = await chatClient();
    const { workspaceId } = await onboardOrgAndWorkspace(client);
    const chat = await client.post('/api/ai/chat', {
      message: 'Sing me a song',
      workspaceId,
    });
    const events = parseSse(chat.body as string);
    const done = events.find((event) => event.event === 'done');
    expect((done?.data as { status: string }).status).toBe('clarification');
    await client.app.close();
  });
});
