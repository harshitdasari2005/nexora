/**
 * The first Nexora vertical slice, end-to-end at the API boundary
 * (`fastify.inject`): authenticate → create organization → create workspace
 * → reach the dashboard. Repositories are in-memory fakes, so the test needs
 * no Docker or PostgreSQL.
 */

import { describe, expect, it } from 'vitest';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';

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
  FakeOfficeRequestRepository,
  FakeWorkspaceInviteRepository,
  FakeOnboardingRepository,
  FakeProjectTaskRepository,
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
  FailingMembershipRepository,
} from './fakes.js';
import {
  DefaultDocumentTextExtractor,
  InMemoryDocumentStorage,
} from '@nexora/application-documents';
import { InMemorySearchIndex } from '@nexora/module-search';
import type { RepositorySet } from '../src/container.js';

function cookieValue(
  response: { headers: Record<string, unknown> },
  name: string,
): string | undefined {
  const raw = response.headers['set-cookie'];
  const list = Array.isArray(raw) ? (raw as string[]) : raw === undefined ? [] : [raw as string];
  const entry = list.find((cookie) => cookie.startsWith(`${name}=`));
  return entry?.split(';')[0];
}

interface OnboardingClient {
  app: FastifyInstance;
  session: string;
  get(path: string, cookie?: string): Promise<LightMyRequestResponse>;
  post(
    path: string,
    body: Record<string, unknown>,
    cookie?: string,
  ): Promise<LightMyRequestResponse>;
}

/** Builds the app and completes the OIDC login, returning an HTTP client. */
async function onboard(): Promise<OnboardingClient> {
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
    onboardings: new FakeOnboardingRepository(),
    officeRequests: new FakeOfficeRequestRepository(),
    invites: new FakeWorkspaceInviteRepository(),
    projectTasks: new FakeProjectTaskRepository(),
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

  const loginResponse = await app.inject({ method: 'GET', url: '/api/auth/login' });
  const state = cookieValue(loginResponse, 'oidc_state')?.split('=')[1] ?? '';
  const verifier = cookieValue(loginResponse, 'oidc_verifier')?.split('=')[1] ?? '';
  const nonce = cookieValue(loginResponse, 'oidc_nonce')?.split('=')[1] ?? '';
  const callback = await app.inject({
    method: 'GET',
    url: `/api/auth/callback?code=test-code&state=${state}`,
    headers: { cookie: `oidc_state=${state}; oidc_verifier=${verifier}; oidc_nonce=${nonce}` },
  });
  const session = cookieValue(callback, 'nexora_session');
  if (session === undefined) {
    throw new Error('login failed');
  }

  return {
    app,
    session,
    get(path, cookie = session) {
      return app.inject({ method: 'GET', url: path, headers: { cookie } });
    },
    post(path, body, cookie = session) {
      return app.inject({
        method: 'POST',
        url: path,
        headers: { cookie, 'content-type': 'application/json' },
        payload: body,
      });
    },
  };
}

describe('Nexora onboarding slice (E2E via inject)', () => {
  it('walks login → organization → workspace → dashboard', async () => {
    const client = await onboard();

    // 1. The user exists and has no organization yet.
    const me = await client.get('/api/me');
    expect(me.statusCode).toBe(200);
    const meBody = me.json();
    expect(meBody.user.email).toBe('alex@nexora.dev');
    expect(meBody.organizations).toEqual([]);

    // 2. Create the organization (provisioned active with the creator as owner).
    const createOrg = await client.post('/api/organizations', {
      name: 'Acme Inc.',
      slug: 'acme',
      type: 'startup',
      description: 'The first Nexora tenant',
    });
    expect(createOrg.statusCode).toBe(201);
    const organization = createOrg.json().organization;
    expect(organization).toMatchObject({ slug: 'acme', status: 'active', type: 'startup' });

    // 3. The organization is now listed for the user.
    const listOrgs = await client.get('/api/organizations');
    expect(listOrgs.statusCode).toBe(200);
    expect(listOrgs.json().organizations).toHaveLength(1);

    // 4. Create the first workspace inside the organization.
    const createWs = await client.post('/api/workspaces', {
      organizationId: organization.id,
      name: 'Engineering',
      slug: 'engineering',
      type: 'engineering',
    });
    expect(createWs.statusCode).toBe(201);
    const workspace = createWs.json().workspace;
    expect(workspace).toMatchObject({
      organizationId: organization.id,
      slug: 'engineering',
      status: 'active',
    });

    // 5. The workspace is listed under the organization.
    const listWs = await client.get(`/api/workspaces?organizationId=${organization.id}`);
    expect(listWs.statusCode).toBe(200);
    expect(listWs.json().workspaces).toHaveLength(1);

    // 6. The dashboard resolves user + organization + workspace.
    const dashboard = await client.get('/api/dashboard');
    expect(dashboard.statusCode).toBe(200);
    expect(dashboard.json()).toMatchObject({
      user: { email: 'alex@nexora.dev' },
      organization: { slug: 'acme' },
      workspace: { slug: 'engineering' },
      installedApps: [],
      recentActivity: [],
    });

    await client.app.close();
  });

  it('rejects a duplicate organization slug with 409', async () => {
    const client = await onboard();
    await client.post('/api/organizations', { name: 'Acme Inc.', slug: 'acme', type: 'startup' });

    const duplicate = await client.post('/api/organizations', {
      name: 'Acme Two',
      slug: 'acme',
      type: 'startup',
    });
    expect(duplicate.statusCode).toBe(409);
    expect(duplicate.json()).toMatchObject({ error: { code: 'CONFLICT' } });
    await client.app.close();
  });

  it('rejects workspace creation in an organization the user does not belong to', async () => {
    const client = await onboard();
    const forbidden = await client.post('/api/workspaces', {
      organizationId: 'org_alien',
      name: 'Ghost',
      slug: 'ghost',
      type: 'general',
    });
    expect(forbidden.statusCode).toBe(403);
    expect(forbidden.json()).toMatchObject({ error: { code: 'AUTHORIZATION_ERROR' } });
    await client.app.close();
  });

  it('surfaces read-model failures on the dashboard instead of hiding them', async () => {
    // A failing membership query must produce an error response, not a
    // silently-empty dashboard that would push the user into onboarding again.
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
      memberships: new FailingMembershipRepository(),
      workspaces: new FakeWorkspaceRepository(),
      workspaceMemberships: new FakeWorkspaceMembershipRepository(),
      workspaceInstallations: new FakeWorkspaceInstallationRepository(),
      projects: new FakeProjectRepository(),
      resourceAssignments: new FakeResourceAssignmentRepository(),
      employees: new FakeEmployeeRepository(),
      hiringRequisitions: new FakeHiringRequisitionRepository(),
      jobOpenings: new FakeJobOpeningRepository(),
      candidates: new FakeCandidateRepository(),
      onboardings: new FakeOnboardingRepository(),
      officeRequests: new FakeOfficeRequestRepository(),
      invites: new FakeWorkspaceInviteRepository(),
      projectTasks: new FakeProjectTaskRepository(),
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
    const loginResponse = await app.inject({ method: 'GET', url: '/api/auth/login' });
    const state = cookieValue(loginResponse, 'oidc_state')?.split('=')[1] ?? '';
    const verifier = cookieValue(loginResponse, 'oidc_verifier')?.split('=')[1] ?? '';
    const nonce = cookieValue(loginResponse, 'oidc_nonce')?.split('=')[1] ?? '';
    const callback = await app.inject({
      method: 'GET',
      url: `/api/auth/callback?code=test-code&state=${state}`,
      headers: { cookie: `oidc_state=${state}; oidc_verifier=${verifier}; oidc_nonce=${nonce}` },
    });
    const session = cookieValue(callback, 'nexora_session');
    if (session === undefined) {
      throw new Error('login failed');
    }
    const dashboard = await app.inject({
      method: 'GET',
      url: '/api/dashboard',
      headers: { cookie: session },
    });
    expect(dashboard.statusCode).toBe(500);
    expect(dashboard.json()).toMatchObject({ error: { code: 'INTERNAL_ERROR' } });
    await app.close();
  });

  it('rejects malformed request bodies with 400 (schema validation)', async () => {
    const client = await onboard();
    const invalid = await client.post('/api/organizations', { name: 'No type' });
    expect(invalid.statusCode).toBe(400);
    await client.app.close();
  });

  it('rejects a duplicate workspace slug with 409', async () => {
    const client = await onboard();
    const org = (
      await client.post('/api/organizations', { name: 'Acme', slug: 'acme', type: 'startup' })
    ).json().organization;
    await client.post('/api/workspaces', {
      organizationId: org.id,
      name: 'Engineering',
      slug: 'engineering',
      type: 'engineering',
    });
    const duplicate = await client.post('/api/workspaces', {
      organizationId: org.id,
      name: 'Engineering Two',
      slug: 'engineering',
      type: 'engineering',
    });
    expect(duplicate.statusCode).toBe(409);
    await client.app.close();
  });
});
