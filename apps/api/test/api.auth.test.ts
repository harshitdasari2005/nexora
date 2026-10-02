/**
 * Authentication flow tests via `fastify.inject`: the OIDC authorization
 * code dance (login → callback → session cookie), the 401 gate on protected
 * routes, and logout.
 */

import { describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';

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
} from './fakes.js';
import {
  DefaultDocumentTextExtractor,
  InMemoryDocumentStorage,
} from '@nexora/application-documents';
import { InMemorySearchIndex } from '@nexora/module-search';
import type { RepositorySet } from '../src/container.js';

/** The cookie value of a `Set-Cookie` header entry, or `undefined`. */
function cookieValue(
  response: { headers: Record<string, unknown> },
  name: string,
): string | undefined {
  const raw = response.headers['set-cookie'];
  const list = Array.isArray(raw) ? (raw as string[]) : raw === undefined ? [] : [raw as string];
  const entry = list.find((cookie) => cookie.startsWith(`${name}=`));
  return entry?.split(';')[0];
}

interface TestApp {
  app: FastifyInstance;
  oidc: FakeOidcGateway;
}

async function makeApp(): Promise<TestApp> {
  const config = loadConfig({
    DATABASE_URL: 'postgres://test:test@localhost:5432/test',
    LOG_LEVEL: 'error',
    INTEGRATIONS_INBOUND_SECRET: 'test-inbound-secret',
    WEB_ORIGIN: 'http://localhost:5173',
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
  const oidc = new FakeOidcGateway();
  const app = await buildApp({ config, oidc, repositories });
  return { app, oidc };
}

/** Runs the full login dance and returns the session cookie value. */
async function login(app: FastifyInstance): Promise<string> {
  const loginResponse = await app.inject({ method: 'GET', url: '/api/auth/login' });
  const state = cookieValue(loginResponse, 'oidc_state')?.split('=')[1];
  const verifier = cookieValue(loginResponse, 'oidc_verifier')?.split('=')[1];
  const nonce = cookieValue(loginResponse, 'oidc_nonce')?.split('=')[1];
  if (state === undefined || verifier === undefined) {
    throw new Error('login did not set the oidc_state/oidc_verifier cookies');
  }
  const callback = await app.inject({
    method: 'GET',
    url: `/api/auth/callback?code=test-code&state=${state}`,
    headers: { cookie: `oidc_state=${state}; oidc_verifier=${verifier}; oidc_nonce=${nonce}` },
  });
  const session = cookieValue(callback, 'nexora_session');
  if (session === undefined) {
    throw new Error('callback did not set the session cookie');
  }
  return session;
}

describe('health', () => {
  it('reports ok without authentication', async () => {
    const { app } = await makeApp();
    const response = await app.inject({ method: 'GET', url: '/api/health' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ status: 'ok', service: 'nexora-api' });
    await app.close();
  });
});

describe('protected routes', () => {
  it('reject unauthenticated requests with 401', async () => {
    const { app } = await makeApp();
    const response = await app.inject({ method: 'GET', url: '/api/me' });
    expect(response.statusCode).toBe(401);
    expect(response.json()).toMatchObject({
      error: { code: 'AUTHORIZATION_ERROR', message: 'Unauthorized' },
    });
    await app.close();
  });

  it('reject requests with an invalid session token', async () => {
    const { app } = await makeApp();
    const response = await app.inject({
      method: 'GET',
      url: '/api/me',
      headers: { cookie: 'nexora_session=not-a-real-token' },
    });
    expect(response.statusCode).toBe(401);
    await app.close();
  });
});

describe('OIDC login flow', () => {
  it('redirects to the IdP and sets CSRF state + PKCE verifier cookies', async () => {
    const { app } = await makeApp();
    const response = await app.inject({ method: 'GET', url: '/api/auth/login' });
    expect(response.statusCode).toBe(302);
    expect(response.headers.location).toContain('http://keycloak.test/');
    // The authorization URL carries the PKCE challenge for the public client.
    expect(String(response.headers.location)).toContain('code_challenge=');
    expect(String(response.headers.location)).toContain('code_challenge_method=S256');
    expect(cookieValue(response, 'oidc_state')).toBeDefined();
    expect(cookieValue(response, 'oidc_verifier')).toBeDefined();
    await app.close();
  });

  it('rejects a callback missing the PKCE verifier', async () => {
    const { app } = await makeApp();
    const loginResponse = await app.inject({ method: 'GET', url: '/api/auth/login' });
    const state = cookieValue(loginResponse, 'oidc_state')?.split('=')[1] ?? '';
    const response = await app.inject({
      method: 'GET',
      url: `/api/auth/callback?code=test-code&state=${state}`,
      headers: { cookie: `oidc_state=${state}` },
    });
    expect(response.statusCode).toBe(400);
    await app.close();
  });

  it('exchanges the code with the PKCE verifier', async () => {
    const { app, oidc } = await makeApp();
    await login(app);
    expect(oidc.exchangedVerifiers).toHaveLength(1);
    expect(oidc.exchangedVerifiers[0]).toBeTruthy();
    await app.close();
  });

  it('completes the code exchange and issues the session cookie', async () => {
    const { app } = await makeApp();
    const session = await login(app);
    expect(session.startsWith('nexora_session=')).toBe(true);
    await app.close();
  });

  it('rejects a callback with a mismatched state', async () => {
    const { app } = await makeApp();
    const response = await app.inject({
      method: 'GET',
      url: '/api/auth/callback?code=test-code&state=wrong-state',
      headers: { cookie: 'oidc_state=right-state' },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({
      error: { code: 'VALIDATION_ERROR', message: 'Invalid OIDC callback state' },
    });
    await app.close();
  });

  it('clears the OIDC cookies when the callback fails', async () => {
    const { app } = await makeApp();
    const response = await app.inject({
      method: 'GET',
      url: '/api/auth/callback?code=test-code&state=wrong-state',
      headers: { cookie: 'oidc_state=right-state; oidc_verifier=abc' },
    });
    expect(response.statusCode).toBe(400);
    // Both single-use cookies must be expired so the stale attempt cannot
    // shadow the next login.
    const cookies = response.headers['set-cookie'];
    const list = Array.isArray(cookies)
      ? (cookies as string[])
      : cookies === undefined
        ? []
        : [cookies as string];
    expect(list.some((cookie) => cookie.startsWith('oidc_state=;'))).toBe(true);
    expect(list.some((cookie) => cookie.startsWith('oidc_verifier=;'))).toBe(true);
    await app.close();
  });

  it('redirects to the web origin after a successful callback', async () => {
    const { app } = await makeApp();
    const loginResponse = await app.inject({ method: 'GET', url: '/api/auth/login' });
    const state = cookieValue(loginResponse, 'oidc_state')?.split('=')[1] ?? '';
    const verifier = cookieValue(loginResponse, 'oidc_verifier')?.split('=')[1] ?? '';
    const nonce = cookieValue(loginResponse, 'oidc_nonce')?.split('=')[1] ?? '';
    const response = await app.inject({
      method: 'GET',
      url: `/api/auth/callback?code=test-code&state=${state}`,
      headers: { cookie: `oidc_state=${state}; oidc_verifier=${verifier}; oidc_nonce=${nonce}` },
    });
    expect(response.statusCode).toBe(302);
    expect(response.headers.location).toBe('http://localhost:5173/app');
    await app.close();
  });

  it('resolves the authenticated user via /api/me', async () => {
    const { app } = await makeApp();
    const session = await login(app);
    const response = await app.inject({
      method: 'GET',
      url: '/api/me',
      headers: { cookie: session },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      user: {
        email: 'alex@nexora.dev',
        displayName: 'Alex Morgan',
        status: 'active',
      },
    });
    await app.close();
  });

  it('ends the session on logout and revokes access', async () => {
    const { app } = await makeApp();
    const session = await login(app);

    const logout = await app.inject({
      method: 'GET',
      url: '/api/auth/logout',
      headers: { cookie: session },
    });
    expect(logout.statusCode).toBe(302);

    const after = await app.inject({
      method: 'GET',
      url: '/api/me',
      headers: { cookie: session },
    });
    expect(after.statusCode).toBe(401);
    await app.close();
  });

  it('redirects logout to the IdP end-session endpoint (single logout)', async () => {
    const { app } = await makeApp();
    const session = await login(app);
    const logout = await app.inject({
      method: 'GET',
      url: '/api/auth/logout',
      headers: { cookie: session },
    });
    expect(logout.statusCode).toBe(302);
    const location = String(logout.headers.location);
    expect(location).toContain('openid-connect/logout');
    expect(location).toContain(encodeURIComponent('http://localhost:5173/'));
    await app.close();
  });
});
