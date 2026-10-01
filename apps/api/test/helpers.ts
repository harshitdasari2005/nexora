/**
 * Shared test harness for the API test suite (`fastify.inject`, fakes, and
 * the in-memory conversation store). Keeps the E2E chat tests and the AI
 * security suite on one harness so the app is built and logged in exactly
 * once per test. Also provides seeding helpers that construct real domain
 * aggregates (Workspace / WorkspaceMembership) directly into the fake
 * repositories — the only way to model non-member and cross-tenant data the
 * onboarding API cannot create.
 */

import { expect } from 'vitest';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { InMemoryConversationStore } from '@nexora/ai-runtime/conversation';
import type { TenantId, UserId } from '@nexora/contracts/common';
import {
  Workspace,
  WorkspaceMembership,
  WorkspaceSlug,
  WorkspaceStatus,
  WorkspaceType,
  type MembershipRole,
  type WorkspaceId,
} from '@nexora/domain-workspaces';
import {
  Organization,
  OrganizationMembership,
  OrganizationSlug,
  OrganizationStatus,
  OrganizationType,
  type OrganizationId,
} from '@nexora/domain-organizations';
import type { MembershipRole as OrgMembershipRole } from '@nexora/domain-organizations';
import { Project, type ProjectId, type ProjectStatusValue } from '@nexora/domain-projects';
import { Employee, type EmployeeId } from '@nexora/domain-hr';
import { Document, type DocumentId } from '@nexora/domain-documents';
import type { DocumentTemplate } from '@nexora/domain-documents';
import {
  DocumentTemplate as DocumentTemplateFactory,
  DocumentVersion as DocumentVersionFactory,
} from '@nexora/domain-documents';
import {
  KnowledgeArticle as KnowledgeArticleFactory,
  KnowledgeCategory as KnowledgeCategoryFactory,
  KnowledgeSource,
  type KnowledgeArticleId,
  type KnowledgeCategoryId,
  type KnowledgeSourceId,
} from '@nexora/domain-knowledge';
import type { TenantId as ProjectTenantId } from '@nexora/contracts/common';

import { loadConfig } from '../src/config.js';
import { InMemoryLineageRepository } from '@nexora/module-lineage';
import { InMemoryPolicySettingsRepository } from '../src/policy/policy-settings.js';
import { buildApp } from '../src/app.js';
import type { RepositorySet } from '../src/container.js';
import type { OidcGateway } from '../src/oidc/gateway.js';
import { InMemoryProblemStore } from '../src/detection/in-memory-problem-store.js';
import { InMemoryPlanStore } from '@nexora/module-remediation';
import {
  FakeActivityRepository,
  FakeBudgetRepository,
  FakeCalendarEntryRepository,
  FakeDocumentRepository,
  FakeExpenseRepository,
  FakeDocumentTemplateRepository,
  FakeAgentExecutionRecorder,
  FakeDocumentVersionRepository,
  FakeEmailOutboxRepository,
  FakeInboundMessageRepository,
  FakeEmployeeRepository,
  FakeMeasurementRepository,
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
  MultiIdentityGateway,
} from './fakes.js';
import {
  DefaultDocumentTextExtractor,
  InMemoryDocumentStorage,
} from '@nexora/application-documents';
import { InMemorySearchIndex } from '@nexora/module-search';
import {
  InMemoryAgentDelegationRepository,
  InMemoryAgentIdentityRepository,
} from '@nexora/module-agents';
import type { AgentResourceScope } from '@nexora/contracts/agent';

/** Extracts a cookie value from a set-cookie header. */
export function cookieValue(
  response: { headers: Record<string, unknown> },
  name: string,
): string | undefined {
  const raw = response.headers['set-cookie'];
  const list = Array.isArray(raw) ? (raw as string[]) : raw === undefined ? [] : [raw as string];
  const entry = list.find((cookie) => cookie.startsWith(`${name}=`));
  return entry?.split(';')[0];
}

/** Parses an SSE body into typed events. */
export function parseSse(body: string): { event: string; data: unknown }[] {
  return body
    .split(/\r?\n\r?\n/)
    .filter((block) => block.trim().length > 0)
    .map((block) => {
      let event = 'message';
      const dataLines: string[] = [];
      for (const line of block.split(/\r?\n/)) {
        if (line.startsWith('event:')) {
          event = line.slice('event:'.length).trim();
        } else if (line.startsWith('data:')) {
          dataLines.push(line.slice('data:'.length).trimStart());
        }
      }
      return { event, data: JSON.parse(dataLines.join('\n')) as unknown };
    });
}

/** A logged-in API test client. */
export interface ChatClient {
  /** The built Fastify app. */
  app: FastifyInstance;
  /** The session cookie for the logged-in user. */
  session: string;
  /** The conversation store backing the AI runtime. */
  store: InMemoryConversationStore;
  /** The fake repositories (shared with the app — seed here for security tests). */
  repos: RepositorySet;
  /** GET with the session cookie. */
  get(path: string): Promise<LightMyRequestResponse>;
  /** POST JSON with the session cookie. */
  post(path: string, body?: Record<string, unknown>): Promise<LightMyRequestResponse>;
  /** PUT JSON with the session cookie. */
  put(path: string, body?: Record<string, unknown>): Promise<LightMyRequestResponse>;
  /** PATCH JSON with the session cookie. */
  patch(path: string, body?: Record<string, unknown>): Promise<LightMyRequestResponse>;
  /** POST with an explicit empty JSON body (avoids Fastify empty-body 400). */
  postEmpty(path: string): Promise<LightMyRequestResponse>;
}

/**
 * Builds the app with in-memory fakes and an in-memory conversation store.
 * Pass a custom {@link OidcGateway} to provision multiple distinct users
 * (each login dance issues a session for the gateway's next identity).
 */
export async function buildTestApp(
  options: {
    oidc?: OidcGateway;
    webhookHttp?: Parameters<typeof buildApp>[0]['webhookHttp'];
    connectors?: Parameters<typeof buildApp>[0]['connectors'];
    agentExecutionRecorder?: Parameters<typeof buildApp>[0]['agentExecutionRecorder'];
    problemStore?: Parameters<typeof buildApp>[0]['problemStore'];
    planStore?: Parameters<typeof buildApp>[0]['planStore'];
    /** The agent-authority clock (Prompt 4 delegation expiry tests). */
    agentClock?: () => Date;
    /** The approval expiry clock (Prompt 8); defaults to `agentClock`. */
    approvalClock?: () => Date;
    /** Injects a policy engine with extra rules (Prompt 5). */
    policyEngine?: Parameters<typeof buildApp>[0]['policyEngine'];
    /** Extra environment variables (e.g. `NEXORA_DEMO_MODE: 'true'`). */
    env?: Record<string, string>;
  } = {},
): Promise<{ app: FastifyInstance; repos: RepositorySet; store: InMemoryConversationStore }> {
  const config = loadConfig({
    DATABASE_URL: 'postgres://test:test@localhost:5432/test',
    LOG_LEVEL: 'error',
    INTEGRATIONS_INBOUND_SECRET: 'test-inbound-secret',
    ...options.env,
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
    agents: new InMemoryAgentIdentityRepository(),
    agentDelegations: new InMemoryAgentDelegationRepository(),
    policySettings: new InMemoryPolicySettingsRepository(),
    lineage: new InMemoryLineageRepository(),
    notifications: new FakeNotificationRepository(),
    notificationPreferences: new FakeNotificationPreferencesRepository(),
    activity: new FakeActivityRepository(),
  };
  const store = new InMemoryConversationStore();
  const app = await buildApp({
    config,
    oidc: options.oidc ?? new FakeOidcGateway(),
    repositories,
    aiStore: store,
    ...(options.agentClock === undefined ? {} : { agentClock: options.agentClock }),
    ...(options.approvalClock === undefined ? {} : { approvalClock: options.approvalClock }),
    ...(options.policyEngine === undefined ? {} : { policyEngine: options.policyEngine }),
    webhookHttp: options.webhookHttp,
    connectors: options.connectors,
    // Journal governed agent executions in-memory so the agent tests can
    // verify the S26 Phase 8 measurements (recentRuns) without a database.
    agentExecutionRecorder: options.agentExecutionRecorder ?? new FakeAgentExecutionRecorder(),
    // Persist detected problems in-memory so the S27 detection tests can
    // verify the problem lifecycle without a database.
    problemStore: options.problemStore ?? new InMemoryProblemStore(),
    // Persist remediation plans in-memory so the Phase 10 tests can verify
    // the plan lifecycle without a database.
    planStore: options.planStore ?? new InMemoryPlanStore(),
  });
  return { app, repos: repositories, store };
}

/**
 * Performs the OIDC login dance against an app and returns the session
 * cookie. Each call provisions the gateway's next identity (call twice with
 * a multi-identity gateway for two distinct users).
 */
export async function login(app: FastifyInstance): Promise<string> {
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
  return session;
}

/** Builds the app (fakes + in-memory conversation store) and logs in. */
export async function chatClient(
  options: Parameters<typeof buildTestApp>[0] = {},
): Promise<ChatClient> {
  const { app, repos, store } = await buildTestApp(options);
  const session = await login(app);

  return {
    app,
    session,
    store,
    repos,
    get(path) {
      return app.inject({ method: 'GET', url: path, headers: { cookie: session } });
    },
    /** Posts with an explicit empty JSON body (avoids Fastify empty-body 400). */
    postEmpty(path) {
      return app.inject({
        method: 'POST',
        url: path,
        headers: { cookie: session, 'content-type': 'application/json' },
        payload: {},
      });
    },
    post(path, body) {
      return app.inject({
        method: 'POST',
        url: path,
        headers: { cookie: session, 'content-type': 'application/json' },
        payload: body,
      });
    },
    put(path, body) {
      return app.inject({
        method: 'PUT',
        url: path,
        headers: { cookie: session, 'content-type': 'application/json' },
        payload: body,
      });
    },
    patch(path, body) {
      return app.inject({
        method: 'PATCH',
        url: path,
        headers: { cookie: session, 'content-type': 'application/json' },
        payload: body,
      });
    },
  };
}

/** A second logged-in user (e.g. a distinct approver) alongside the first. */
export interface SecondUser {
  cookie: string;
  userId: string;
  /** POST JSON as the second user. */
  post(path: string, body?: Record<string, unknown>): Promise<LightMyRequestResponse>;
  /** GET as the second user. */
  get(path: string): Promise<LightMyRequestResponse>;
  /** Makes the second user a member of the org + workspace with the given roles. */
  join(input: {
    organizationId: string;
    workspaceId: string;
    orgRole?: OrgMembershipRole;
    workspaceRole: MembershipRole;
  }): Promise<void>;
}

/**
 * Like {@link chatClient} but with two distinct identities: the returned
 * client is the first user; `second` is a separately logged-in user who is
 * NOT yet a member of anything (call `second.join(...)`). Used for
 * separation-of-duties flows (Prompt 8: requester != approver).
 */
export async function chatClientWithSecondUser(
  options: Parameters<typeof buildTestApp>[0] = {},
): Promise<ChatClient & { second: SecondUser }> {
  const issuer = 'http://keycloak.test/realms/nexora';
  const { app, repos, store } = await buildTestApp({
    ...options,
    oidc: new MultiIdentityGateway([
      {
        subject: 'sub-requester-1',
        email: 'requester@nexora.dev',
        emailVerified: true,
        displayName: 'Rita Requester',
        issuer,
      },
      {
        subject: 'sub-approver-2',
        email: 'approver@nexora.dev',
        emailVerified: true,
        displayName: 'Ada Approver',
        issuer,
      },
    ]),
  });
  const session = await login(app);
  const secondCookie = await login(app);
  const call = (
    method: 'GET' | 'POST' | 'PUT' | 'PATCH',
    cookie: string,
    url: string,
    payload?: Record<string, unknown>,
  ) =>
    app.inject({
      method,
      url,
      headers: { cookie, 'content-type': 'application/json' },
      payload: payload ?? {},
    });
  const me = await app.inject({ method: 'GET', url: '/api/me', headers: { cookie: secondCookie } });
  const secondId = (me.json() as { user: { id: string } }).user.id;
  return {
    app,
    session,
    store,
    repos,
    get: (path) => call('GET', session, path),
    postEmpty: (path) => call('POST', session, path),
    post: (path, body) => call('POST', session, path, body),
    put: (path, body) => call('PUT', session, path, body),
    patch: (path, body) => call('PATCH', session, path, body),
    second: {
      cookie: secondCookie,
      userId: secondId,
      get: (path) => call('GET', secondCookie, path),
      post: (path, body) => call('POST', secondCookie, path, body),
      async join(input) {
        await seedOrganizationMembership(repos, {
          organizationId: input.organizationId,
          userId: secondId,
          role: input.orgRole ?? 'member',
        });
        await seedWorkspaceMembership(repos, {
          organizationId: input.organizationId,
          workspaceId: input.workspaceId,
          userId: secondId,
          role: input.workspaceRole,
        });
      },
    },
  };
}

/** The user id of the logged-in test user (single-user fakes). */
export function currentUserId(client: ChatClient): UserId {
  const users = [...(client.repos.users as FakeUserRepository).users.values()];
  const user = users[0];
  if (user === undefined) {
    throw new Error('no test user provisioned');
  }
  return user.id;
}

/**
 * Creates an organization and a workspace through the onboarding API. The
 * creator becomes the workspace's `owner`; the workspace `type` (default
 * `engineering`) selects which business role that owner resolves to (P0
 * hardening's per-domain capability set — e.g. `type: 'legal'` resolves the
 * owner to `legal.general_counsel`, the role holding `documents.upload`).
 */
export async function onboardOrgAndWorkspace(
  client: ChatClient,
  options?: { workspaceType?: string },
): Promise<{ organizationId: string; workspaceId: string; workspaceSlug: string }> {
  const org = await client.post('/api/organizations', {
    name: 'Acme Inc.',
    slug: 'acme',
    type: 'startup',
  });
  expect(org.statusCode).toBe(201);
  const organizationId = (org.json().organization as { id: string }).id;

  const workspace = await client.post('/api/workspaces', {
    organizationId,
    name: 'Engineering',
    slug: 'engineering',
    type: options?.workspaceType ?? 'engineering',
  });
  expect(workspace.statusCode).toBe(201);
  const created = workspace.json().workspace as { id: string; slug: string };
  return { organizationId, workspaceId: created.id, workspaceSlug: created.slug };
}

/**
 * Seeds a Workspace aggregate with a fixed id directly into the fake
 * repository (real domain construction — active status, no membership). Used
 * to model workspaces the onboarding API cannot create (non-member, other
 * tenant).
 */
export async function seedWorkspace(
  repos: RepositorySet,
  input: { id: string; organizationId: string; slug: string; name?: string; type?: string },
): Promise<void> {
  const organizationId = input.organizationId as TenantId;
  const created = Workspace.create(
    {
      organizationId,
      slug: WorkspaceSlug.create(input.slug),
      name: input.name ?? input.slug,
      type: input.type === undefined ? WorkspaceType.engineering() : WorkspaceType.from(input.type),
      status: WorkspaceStatus.active(),
    },
    { actor: { kind: 'system', id: 'system' }, correlationId: 'corr_seed', organizationId },
  );
  const seeded = Workspace.hydrate({ ...Workspace.snapshot(created), id: input.id as WorkspaceId });
  await repos.workspaces.save(seeded);
}

/**
 * Seeds a Project aggregate with a fixed id directly into the fake
 * repository (real domain construction). Used to model projects the
 * onboarding API cannot create (other tenant, other statuses).
 */
export async function seedProject(
  repos: RepositorySet,
  input: {
    id: string;
    organizationId: string;
    name: string;
    description?: string;
    status?: ProjectStatusValue;
  },
): Promise<void> {
  const organizationId = input.organizationId as ProjectTenantId;
  const created = Project.create(
    {
      organizationId,
      name: input.name,
      description: input.description,
    },
    { actor: { kind: 'user', id: 'usr_seed' }, correlationId: 'corr_seed', organizationId },
  );
  const seeded = Project.hydrate({
    ...Project.snapshot(created),
    id: input.id as ProjectId,
    status: input.status ?? 'proposed',
  });
  await repos.projects.save(seeded);
}

/**
 * Seeds an Employee aggregate with a fixed id directly into the fake
 * repository (real domain construction — active status so it is assignable,
 * BR-16). Used to model employees the onboarding API cannot create (other
 * tenant, inactive).
 */
export async function seedEmployee(
  repos: RepositorySet,
  input: {
    id: string;
    organizationId: string;
    name: string;
    status?: 'proposed' | 'hired' | 'onboarding' | 'active';
  },
): Promise<void> {
  const organizationId = input.organizationId as ProjectTenantId;
  const created = Employee.create(
    { organizationId, name: input.name },
    { actor: { kind: 'user', id: 'usr_seed' }, correlationId: 'corr_seed', organizationId },
  );
  const seeded = Employee.hydrate({
    ...Employee.snapshot(created),
    id: input.id as EmployeeId,
    status: input.status ?? 'active',
  });
  await repos.employees.save(seeded);
}

/**
 * Seeds an Organization aggregate with a fixed id directly into the fake
 * repository (real domain construction — active status). Used to model
 * organizations the onboarding API cannot create (other tenant) and to give
 * the AI write tools their membership authorization query real data.
 */
export async function seedOrganization(
  repos: RepositorySet,
  input: { id: string; slug: string; name?: string },
): Promise<void> {
  const created = Organization.create(
    {
      slug: OrganizationSlug.create(input.slug),
      name: input.name ?? input.slug,
      type: OrganizationType.startup(),
      status: OrganizationStatus.active(),
    },
    { actor: { kind: 'system', id: 'system' }, correlationId: 'corr_seed' },
  );
  created.pullDomainEvents();
  const seeded = Organization.hydrate({
    ...Organization.snapshot(created),
    id: input.id as OrganizationId,
  });
  await repos.organizations.save(seeded);
}

/** Seeds an OrganizationMembership aggregate into the fake repository. */
export async function seedOrganizationMembership(
  repos: RepositorySet,
  input: { organizationId: string; userId: string; role: OrgMembershipRole },
): Promise<void> {
  const membership = OrganizationMembership.create(
    {
      organizationId: input.organizationId as OrganizationId,
      userId: input.userId as UserId,
      role: input.role,
    },
    {
      actor: { kind: 'user', id: input.userId as UserId },
      correlationId: 'corr_seed',
      tenantId: input.organizationId as TenantId,
    },
  );
  await repos.memberships.save(membership);
}

/**
 * Seeds an available Document aggregate into the fake repository and indexes
 * its text into the knowledge index (the document → knowledge flow). The
 * uploader must be a workspace member for AI retrieval to see it.
 */
export async function seedDocumentAndKnowledge(
  repos: RepositorySet,
  input: {
    id: string;
    organizationId: string;
    workspaceId: string;
    uploaderId: string;
    title: string;
    text: string;
  },
): Promise<void> {
  const organizationId = input.organizationId as TenantId;
  const workspaceId = input.workspaceId as WorkspaceId;
  const document = Document.hydrate({
    id: input.id as DocumentId,
    organizationId,
    workspaceId,
    uploaderId: input.uploaderId as UserId,
    title: input.title,
    contentType: 'text/markdown',
    contentRef: `content://${input.id}/1`,
    status: 'available',
    contentVersion: 1,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    version: 1,
  });
  await repos.documents.save(document);

  const source = KnowledgeSource.hydrate({
    id: `src_${input.id}` as KnowledgeSourceId,
    tenantId: organizationId,
    workspaceId,
    documentId: input.id,
    title: input.title,
    text: input.text,
    version: 1,
    indexedAt: new Date().toISOString(),
  });
  await repos.knowledgeSources.save(source);
  await repos.searchIndex.put({
    id: source.id,
    tenantId: organizationId,
    workspaceId,
    scopeId: input.id,
    kind: 'document',
    title: input.title,
    text: input.text,
    version: 1,
    indexedAt: source.indexedAt,
  });
}

/**
 * Seeds an immutable DocumentVersion record into the fake repository (real
 * domain construction). Used to model version histories the API cannot
 * create in a foreign scope.
 */
export async function seedDocumentVersion(
  repos: RepositorySet,
  input: {
    documentId: string;
    organizationId: string;
    workspaceId: string;
    version: number;
    contentRef: string;
    contentType?: string;
    createdBy: string;
  },
): Promise<void> {
  const record = DocumentVersionFactory.create({
    documentId: input.documentId as never,
    organizationId: input.organizationId as TenantId,
    workspaceId: input.workspaceId as WorkspaceId,
    version: input.version,
    contentRef: input.contentRef,
    contentType: input.contentType ?? 'text/plain',
    createdBy: input.createdBy as UserId,
  });
  await repos.documentVersions.save(record);
}

/**
 * Seeds a DocumentTemplate aggregate into the fake repository (real domain
 * construction). Used to model templates the API cannot create in a foreign
 * scope.
 */
export async function seedDocumentTemplate(
  repos: RepositorySet,
  input: {
    id?: string;
    organizationId: string;
    workspaceId: string;
    createdBy: string;
    name: string;
    contentType?: string;
    contentRef: string;
    status?: 'active' | 'archived';
  },
): Promise<DocumentTemplate> {
  const context = {
    actor: { kind: 'user' as const, id: input.createdBy as UserId },
    correlationId: 'corr_seed_tpl',
    organizationId: input.organizationId as TenantId,
  };
  const created = DocumentTemplateFactory.create(
    {
      organizationId: input.organizationId as TenantId,
      workspaceId: input.workspaceId as WorkspaceId,
      createdBy: input.createdBy as UserId,
      name: input.name,
      contentType: input.contentType ?? 'text/markdown',
      contentRef: input.contentRef,
    },
    context,
  );
  created.pullDomainEvents();
  const template =
    input.id === undefined
      ? created
      : DocumentTemplateFactory.hydrate({
          ...DocumentTemplateFactory.snapshot(created),
          id: input.id,
        });
  if (input.status === 'archived') {
    template.archive(context);
  }
  template.pullDomainEvents();
  await repos.documentTemplates.save(template);
  return template;
}

/**
 * Seeds a KnowledgeCategory aggregate with a fixed id directly into the fake
 * repository (real domain construction). Used to model categories the API
 * cannot create in a foreign scope (other tenant / archived).
 */
export async function seedKnowledgeCategory(
  repos: RepositorySet,
  input: {
    id: string;
    organizationId: string;
    workspaceId: string;
    name: string;
    archived?: boolean;
  },
): Promise<KnowledgeCategoryId> {
  const context = {
    actor: { kind: 'user' as const, id: 'usr_seed' as UserId },
    correlationId: 'corr_seed_cat',
    organizationId: input.organizationId as TenantId,
  };
  const created = KnowledgeCategoryFactory.create(
    {
      tenantId: input.organizationId as TenantId,
      workspaceId: input.workspaceId as WorkspaceId,
      name: input.name,
    },
    context,
  );
  created.pullDomainEvents();
  const category =
    input.archived === true
      ? (() => {
          created.archive(context);
          created.pullDomainEvents();
          return KnowledgeCategoryFactory.hydrate({
            ...KnowledgeCategoryFactory.snapshot(created),
            id: input.id as KnowledgeCategoryId,
          });
        })()
      : KnowledgeCategoryFactory.hydrate({
          ...KnowledgeCategoryFactory.snapshot(created),
          id: input.id as KnowledgeCategoryId,
        });
  await repos.knowledgeCategories.save(category);
  return category.id;
}

/**
 * Seeds a KnowledgeArticle aggregate with a fixed id directly into the fake
 * repository (real domain construction). Used to model articles the API
 * cannot create in a foreign scope (other tenant / other statuses).
 */
export async function seedKnowledgeArticle(
  repos: RepositorySet,
  input: {
    id: string;
    organizationId: string;
    workspaceId: string;
    author: string;
    title: string;
    body: string;
    categoryId?: string;
    status?: 'draft' | 'published' | 'archived';
  },
): Promise<KnowledgeArticleId> {
  const context = {
    actor: { kind: 'user' as const, id: input.author as UserId },
    correlationId: 'corr_seed_art',
    organizationId: input.organizationId as TenantId,
  };
  const created = KnowledgeArticleFactory.create(
    {
      tenantId: input.organizationId as TenantId,
      workspaceId: input.workspaceId as WorkspaceId,
      title: input.title,
      body: input.body,
      categoryId: input.categoryId as KnowledgeCategoryId | undefined,
      author: input.author as UserId,
    },
    context,
  );
  created.pullDomainEvents();
  if (input.status === 'published') {
    created.publish(context);
    created.pullDomainEvents();
  } else if (input.status === 'archived') {
    created.publish(context);
    created.archive(context);
    created.pullDomainEvents();
  }
  const article = KnowledgeArticleFactory.hydrate({
    ...KnowledgeArticleFactory.snapshot(created),
    id: input.id as KnowledgeArticleId,
  });
  await repos.knowledgeArticles.save(article);
  return article.id;
}

/** Seeds a WorkspaceMembership aggregate into the fake repository. */
export async function seedWorkspaceMembership(
  repos: RepositorySet,
  input: {
    workspaceId: string;
    userId: string;
    role: MembershipRole;
    organizationId: string;
  },
): Promise<void> {
  const membership = WorkspaceMembership.create(
    {
      workspaceId: input.workspaceId as WorkspaceId,
      userId: input.userId as UserId,
      role: input.role,
    },
    {
      actor: { kind: 'user', id: input.userId as UserId },
      correlationId: 'corr_seed',
      organizationId: input.organizationId as TenantId,
    },
  );
  await repos.workspaceMemberships.save(membership);
}

/**
 * Seeds a persisted agent identity + its delegations directly into the
 * repositories (Prompt 4 test helper). The delegations are granted by the
 * current user (the grantor must still hold each capability at execution
 * time for them to be effective). Returns the agent and delegation ids.
 */
export async function provisionAgent(
  repos: RepositorySet,
  input: {
    organizationId: string;
    workspaceId: string;
    definitionId: string;
    grantedBy: string;
    capabilityIds: readonly string[];
    name?: string;
    status?: 'active' | 'suspended' | 'revoked';
    resourceScope?: AgentResourceScope;
    expiresAt?: string;
    id?: string;
  },
): Promise<{ agentId: string; delegationIds: string[] }> {
  if (repos.agents === undefined || repos.agentDelegations === undefined) {
    throw new Error('provisionAgent requires in-memory agent repositories');
  }
  const at = '2026-01-01T00:00:00.000Z';
  const agentId = input.id ?? `agt_${Math.random().toString(16).slice(2, 10)}`;
  await repos.agents.save({
    id: agentId,
    organizationId: input.organizationId,
    workspaceId: input.workspaceId,
    definitionId: input.definitionId,
    name: input.name ?? `${input.definitionId} agent`,
    description: 'test agent',
    status: input.status ?? 'active',
    ownerUserId: input.grantedBy,
    createdBy: input.grantedBy,
    createdAt: at,
    updatedAt: at,
  });
  const delegationIds: string[] = [];
  for (const capabilityId of input.capabilityIds) {
    const id = `dlg_${agentId.slice(4)}_${delegationIds.length + 1}`;
    await repos.agentDelegations.save({
      id,
      agentId,
      organizationId: input.organizationId,
      workspaceId: input.workspaceId,
      grantedByUserId: input.grantedBy,
      capabilityId,
      ...(input.resourceScope === undefined ? {} : { resourceScope: input.resourceScope }),
      status: 'active',
      createdAt: at,
      ...(input.expiresAt === undefined ? {} : { expiresAt: input.expiresAt }),
    });
    delegationIds.push(id);
  }
  return { agentId, delegationIds };
}
