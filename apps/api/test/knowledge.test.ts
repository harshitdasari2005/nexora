/**
 * S18 Knowledge Base vertical slice — article, category, and retrieval API
 * tests (`fastify.inject`):
 *
 * - Articles follow draft → published → archived. A draft is never indexed
 *   and never retrievable; publishing indexes the article; a published edit
 *   bumps the content version and REPLACES the corpus entry (old content
 *   never answers); archiving removes it from retrieval entirely.
 * - Retrieval is permission-filtered BEFORE scoring: citations come from
 *   trusted search entries and carry `kind` + `version` (AIR §9.3).
 * - Categories are flat and workspace-scoped; a forged/foreign category
 *   resolves to NOT FOUND.
 * - The model can never widen scope: cross-tenant, cross-workspace, and
 *   forged article/category ids fail closed (403/404).
 */

import { describe, expect, it } from 'vitest';

import type { SearchIndexPort } from '@nexora/module-search';
import { loadConfig } from '../src/config.js';
import { buildApp } from '../src/app.js';
import type { RepositorySet } from '../src/container.js';
import { FakeOidcGateway } from './fakes.js';
import {
  FakeActivityRepository,
  FakeCalendarEntryRepository,
  FakeDocumentRepository,
  FakeDocumentTemplateRepository,
  FakeDocumentVersionRepository,
  FakeEmailOutboxRepository,
  FakeInboundMessageRepository,
  FakeEmployeeRepository,
  FakeKnowledgeArticleRepository,
  FakeKnowledgeCategoryRepository,
  FakeKnowledgeSourceRepository,
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
import {
  DefaultDocumentTextExtractor,
  InMemoryDocumentStorage,
} from '@nexora/application-documents';
import {
  chatClient,
  currentUserId,
  login,
  onboardOrgAndWorkspace,
  seedKnowledgeArticle,
  seedKnowledgeCategory,
  seedWorkspace,
  seedWorkspaceMembership,
  type ChatClient,
} from './helpers.js';

/** A {@link SearchIndexPort} whose writes fail (publication gate must surface it). */
class FailingSearchIndex implements SearchIndexPort {
  async put(): Promise<void> {
    throw new Error('simulated index write failure');
  }

  async removeByScope(): Promise<void> {
    throw new Error('simulated index removal failure');
  }

  async query(): Promise<never[]> {
    return [];
  }
}

/** Builds a logged-in client whose search-index writes always fail. */
async function clientWithFailingIndex(): Promise<ChatClient> {
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
    documents: new FakeDocumentRepository(),
    documentVersions: new FakeDocumentVersionRepository(),
    documentTemplates: new FakeDocumentTemplateRepository(),
    knowledgeSources: new FakeKnowledgeSourceRepository(),
    knowledgeArticles: new FakeKnowledgeArticleRepository(),
    knowledgeCategories: new FakeKnowledgeCategoryRepository(),
    calendarEvents: new FakeCalendarEntryRepository(),
    webhookEndpoints: new FakeWebhookEndpointRepository(),
    webhookDeliveries: new FakeWebhookDeliveryRepository(),
    emailOutbox: new FakeEmailOutboxRepository(),
    inboundMessages: new FakeInboundMessageRepository(),
    searchIndex: new FailingSearchIndex(),
    documentStorage: new InMemoryDocumentStorage(),
    documentExtractor: new DefaultDocumentTextExtractor(),
    workflowInstances: new FakeWorkflowInstanceRepository(),
    workflowStepExecutions: new FakeWorkflowStepExecutionRepository(),
    notifications: new FakeNotificationRepository(),
    notificationPreferences: new FakeNotificationPreferencesRepository(),
    activity: new FakeActivityRepository(),
  };
  const app = await buildApp({ config, oidc: new FakeOidcGateway(), repositories });
  const session = await login(app);
  return {
    app,
    session,
    store: undefined as never,
    repos: repositories,
    get(path) {
      return app.inject({ method: 'GET', url: path, headers: { cookie: session } });
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
    postEmpty(path) {
      return app.inject({
        method: 'POST',
        url: path,
        headers: { cookie: session, 'content-type': 'application/json' },
        payload: {},
      });
    },
  };
}

/** Creates an article through the API (draft by default). */
async function createArticle(
  client: ChatClient,
  scope: { organizationId: string; workspaceId: string },
  input: { title: string; body: string; categoryId?: string },
) {
  return client.post('/api/knowledge/articles', {
    organizationId: scope.organizationId,
    workspaceId: scope.workspaceId,
    title: input.title,
    body: input.body,
    categoryId: input.categoryId,
  });
}

/** Publishes an article through the API. */
async function publishArticle(
  client: ChatClient,
  articleId: string,
  scope: { organizationId: string; workspaceId: string },
) {
  return client.post(`/api/knowledge/articles/${articleId}/publish`, {
    organizationId: scope.organizationId,
    workspaceId: scope.workspaceId,
  });
}

/** Searches the knowledge corpus (documents + articles). */
async function search(
  client: ChatClient,
  scope: { organizationId: string; workspaceId: string },
  q: string,
) {
  return client.get(
    `/api/knowledge/search?organizationId=${scope.organizationId}&workspaceId=${scope.workspaceId}&q=${encodeURIComponent(q)}`,
  );
}

describe('S18 knowledge articles (API)', () => {
  it('creates a draft article (never indexed), lists and reads it', async () => {
    const client = await chatClient();
    const scope = await onboardOrgAndWorkspace(client);

    const created = await createArticle(client, scope, {
      title: 'Leave Policy',
      body: 'Employees get 25 annual leave days.',
    });
    expect(created.statusCode).toBe(201);
    const article = (created.json() as { article: { id: string; status: string } }).article;
    expect(article.status).toBe('draft');

    // A draft is NOT retrievable.
    const before = await search(client, scope, 'leave');
    expect((before.json() as { references: unknown[] }).references).toEqual([]);

    // Lists and single-read work.
    const listed = await client.get(
      `/api/knowledge/articles?organizationId=${scope.organizationId}&workspaceId=${scope.workspaceId}`,
    );
    expect(listed.statusCode).toBe(200);
    expect((listed.json() as { articles: { title: string }[] }).articles).toMatchObject([
      { title: 'Leave Policy' },
    ]);

    const single = await client.get(
      `/api/knowledge/articles/${article.id}?organizationId=${scope.organizationId}&workspaceId=${scope.workspaceId}`,
    );
    expect(single.statusCode).toBe(200);
    expect((single.json() as { article: { title: string } }).article.title).toBe('Leave Policy');

    await client.app.close();
  });

  it('publishes an article: indexed once, retrievable with kind+version citation', async () => {
    const client = await chatClient();
    const scope = await onboardOrgAndWorkspace(client);

    const created = await createArticle(client, scope, {
      title: 'Expense Policy',
      body: 'Travel expenses are capped at 500.',
    });
    const articleId = (created.json() as { article: { id: string } }).article.id;

    const published = await publishArticle(client, articleId, scope);
    expect(published.statusCode).toBe(200);
    const publishedBody = published.json() as { article: { status: string }; version: number };
    expect(publishedBody.article.status).toBe('published');
    expect(publishedBody.version).toBe(1);

    // Retrievable with an article citation carrying kind + version.
    const after = await search(client, scope, 'expenses');
    const refs = (after.json() as { references: { kind: string; version: number }[] }).references;
    expect(refs).toHaveLength(1);
    expect(refs[0]?.kind).toBe('article');
    expect(refs[0]?.version).toBe(1);

    await client.app.close();
  });

  it('editing a published article bumps contentVersion and refreshes retrieval', async () => {
    const client = await chatClient();
    const scope = await onboardOrgAndWorkspace(client);

    const created = await createArticle(client, scope, {
      title: 'Leave Policy',
      body: 'Employees get 25 annual leave days.',
    });
    const articleId = (created.json() as { article: { id: string } }).article.id;
    await publishArticle(client, articleId, scope);

    // Old-only token is retrievable.
    expect(
      ((await search(client, scope, '25')).json() as { references: unknown[] }).references,
    ).toHaveLength(1);

    const updated = await client.put(`/api/knowledge/articles/${articleId}`, {
      organizationId: scope.organizationId,
      workspaceId: scope.workspaceId,
      title: 'Leave Policy',
      body: 'Employees get 30 annual leave days effective next quarter.',
    });
    expect(updated.statusCode).toBe(200);
    const updatedBody = updated.json() as { article: { status: string }; version: number };
    expect(updatedBody.article.status).toBe('published');
    expect(updatedBody.version).toBe(2);

    // New content answers; the stale token no longer does.
    expect(
      ((await search(client, scope, '30')).json() as { references: unknown[] }).references,
    ).toHaveLength(1);
    expect(
      ((await search(client, scope, '25')).json() as { references: unknown[] }).references,
    ).toEqual([]);

    // The citation carries the NEW version.
    const refs = (
      (await search(client, scope, 'leave')).json() as { references: { version: number }[] }
    ).references;
    expect(refs[0]?.version).toBe(2);

    await client.app.close();
  });

  it('archiving an article removes it from retrieval', async () => {
    const client = await chatClient();
    const scope = await onboardOrgAndWorkspace(client);

    const created = await createArticle(client, scope, {
      title: 'Remote Policy',
      body: 'Remote work requires manager approval.',
    });
    const articleId = (created.json() as { article: { id: string } }).article.id;
    await publishArticle(client, articleId, scope);
    expect(
      ((await search(client, scope, 'remote')).json() as { references: unknown[] }).references,
    ).toHaveLength(1);

    const archived = await client.post(`/api/knowledge/articles/${articleId}/archive`, {
      organizationId: scope.organizationId,
      workspaceId: scope.workspaceId,
    });
    expect(archived.statusCode).toBe(200);
    expect((archived.json() as { article: { status: string } }).article.status).toBe('archived');

    expect(
      ((await search(client, scope, 'remote')).json() as { references: unknown[] }).references,
    ).toEqual([]);

    // Archiving again fails (terminal state).
    const again = await client.post(`/api/knowledge/articles/${articleId}/archive`, {
      organizationId: scope.organizationId,
      workspaceId: scope.workspaceId,
    });
    expect(again.statusCode).toBe(400);

    await client.app.close();
  });

  it('rejects forged and cross-workspace article access', async () => {
    const client = await chatClient();
    const scope = await onboardOrgAndWorkspace(client);
    const userId = currentUserId(client);

    // An article in a workspace the caller IS a member of but not this one.
    await seedWorkspace(client.repos, {
      id: 'wsp_secret',
      organizationId: scope.organizationId,
      slug: 'secret-ws',
    });
    await seedWorkspaceMembership(client.repos, {
      workspaceId: 'wsp_secret',
      userId,
      role: 'owner',
      organizationId: scope.organizationId,
    });
    await seedKnowledgeArticle(client.repos, {
      id: 'art_11111111-1111-4111-8111-111111111111',
      organizationId: scope.organizationId,
      workspaceId: 'wsp_secret',
      author: userId,
      title: 'Secret Article',
      body: 'Classified content.',
    });

    // Reading through the WRONG workspace resolves to NOT FOUND.
    const foreign = await client.get(
      `/api/knowledge/articles/art_11111111-1111-4111-8111-111111111111?organizationId=${scope.organizationId}&workspaceId=${scope.workspaceId}`,
    );
    expect(foreign.statusCode).toBe(404);

    // Forged (well-formed but non-existent) article id resolves to NOT FOUND.
    const forged = await client.get(
      `/api/knowledge/articles/art_99999999-9999-4999-8999-999999999999?organizationId=${scope.organizationId}&workspaceId=${scope.workspaceId}`,
    );
    expect(forged.statusCode).toBe(404);

    // Publishing a foreign-workspace article through this workspace is denied.
    const publish = await publishArticle(client, 'art_11111111-1111-4111-8111-111111111111', scope);
    expect(publish.statusCode).toBe(404);

    // Foreign tenant: forbidden.
    const foreignTenant = await client.get(
      `/api/knowledge/articles/art_11111111-1111-4111-8111-111111111111?organizationId=org_alien&workspaceId=${scope.workspaceId}`,
    );
    expect(foreignTenant.statusCode).toBe(403);

    await client.app.close();
  });

  it('a publication whose corpus write fails is surfaced loudly (freshness gate)', async () => {
    const client = await clientWithFailingIndex();
    const scope = await onboardOrgAndWorkspace(client);

    const created = await createArticle(client, scope, {
      title: 'Policy',
      body: 'Body.',
    });
    const articleId = (created.json() as { article: { id: string } }).article.id;

    // The corpus write is the freshness gate: the publish must NOT report
    // success while the index entry is missing (a published-but-unindexed
    // article would silently never answer retrieval).
    const published = await publishArticle(client, articleId, scope);
    expect(published.statusCode).toBe(500);
    expect(published.json()).toMatchObject({ error: { code: 'INTERNAL_ERROR' } });

    await client.app.close();
  });

  it('an archive whose corpus removal fails is surfaced loudly', async () => {
    const client = await clientWithFailingIndex();
    const scope = await onboardOrgAndWorkspace(client);

    const created = await createArticle(client, scope, {
      title: 'Policy',
      body: 'Body.',
    });
    const articleId = (created.json() as { article: { id: string } }).article.id;

    // Archiving must NOT report success while the article can still answer
    // retrieval (an archived-but-indexed article violates BR-7).
    const archived = await client.post(`/api/knowledge/articles/${articleId}/archive`, {
      organizationId: scope.organizationId,
      workspaceId: scope.workspaceId,
    });
    expect(archived.statusCode).toBe(500);

    await client.app.close();
  });

  it('rejects article writes from a workspace the caller does not belong to', async () => {
    const client = await chatClient();
    const scope = await onboardOrgAndWorkspace(client);

    const created = await createArticle(client, scope, {
      title: 'Policy',
      body: 'Body.',
    });
    const articleId = (created.json() as { article: { id: string } }).article.id;

    // A workspace the caller is NOT a member of.
    await seedWorkspace(client.repos, {
      id: 'wsp_alien',
      organizationId: scope.organizationId,
      slug: 'alien-ws',
    });

    const update = await client.put(`/api/knowledge/articles/${articleId}`, {
      organizationId: scope.organizationId,
      workspaceId: 'wsp_alien',
      title: 'Sneaky',
      body: 'Sneaky body.',
    });
    expect(update.statusCode).toBe(403);

    const publish = await publishArticle(client, articleId, { ...scope, workspaceId: 'wsp_alien' });
    expect(publish.statusCode).toBe(403);

    await client.app.close();
  });
});

describe('S18 knowledge categories (API)', () => {
  it('creates and lists workspace-scoped categories', async () => {
    const client = await chatClient();
    const scope = await onboardOrgAndWorkspace(client);

    const created = await client.post('/api/knowledge/categories', {
      organizationId: scope.organizationId,
      workspaceId: scope.workspaceId,
      name: 'Policies',
    });
    expect(created.statusCode).toBe(201);
    const categoryId = (created.json() as { category: { id: string } }).category.id;

    const listed = await client.get(
      `/api/knowledge/categories?organizationId=${scope.organizationId}&workspaceId=${scope.workspaceId}`,
    );
    expect(listed.statusCode).toBe(200);
    expect((listed.json() as { categories: { name: string }[] }).categories).toMatchObject([
      { name: 'Policies' },
    ]);

    // An article can be created in that category.
    const article = await createArticle(client, scope, {
      title: 'Leave Policy',
      body: '25 days.',
      categoryId,
    });
    expect(article.statusCode).toBe(201);
    expect((article.json() as { article: { categoryId: string } }).article.categoryId).toBe(
      categoryId,
    );

    await client.app.close();
  });

  it('rejects forged, foreign, and archived category references', async () => {
    const client = await chatClient();
    const scope = await onboardOrgAndWorkspace(client);

    // Forged (well-formed but non-existent) category id → NOT FOUND.
    const forged = await createArticle(client, scope, {
      title: 'Policy',
      body: 'Body.',
      categoryId: 'kcat_99999999-9999-4999-8999-999999999999',
    });
    expect(forged.statusCode).toBe(404);

    // A category in another workspace of the same org (caller is a member
    // there) → NOT FOUND through this workspace.
    const userId = currentUserId(client);
    await seedWorkspace(client.repos, {
      id: 'wsp_catsecret',
      organizationId: scope.organizationId,
      slug: 'cat-secret-ws',
    });
    await seedWorkspaceMembership(client.repos, {
      workspaceId: 'wsp_catsecret',
      userId,
      role: 'owner',
      organizationId: scope.organizationId,
    });
    const foreign = await seedKnowledgeCategory(client.repos, {
      id: 'kcat_22222222-2222-4222-8222-222222222222',
      organizationId: scope.organizationId,
      workspaceId: 'wsp_catsecret',
      name: 'Secret Category',
    });
    const foreignUse = await createArticle(client, scope, {
      title: 'Policy',
      body: 'Body.',
      categoryId: foreign,
    });
    expect(foreignUse.statusCode).toBe(404);

    // An archived category in THIS workspace is unusable.
    await seedKnowledgeCategory(client.repos, {
      id: 'kcat_33333333-3333-4333-8333-333333333333',
      organizationId: scope.organizationId,
      workspaceId: scope.workspaceId,
      name: 'Old Category',
      archived: true,
    });
    const archivedUse = await createArticle(client, scope, {
      title: 'Policy',
      body: 'Body.',
      categoryId: 'kcat_33333333-3333-4333-8333-333333333333',
    });
    expect(archivedUse.statusCode).toBe(404);

    await client.app.close();
  });

  it('rejects category creation from a foreign tenant or workspace', async () => {
    const client = await chatClient();
    const scope = await onboardOrgAndWorkspace(client);

    await seedWorkspace(client.repos, {
      id: 'wsp_alien2',
      organizationId: scope.organizationId,
      slug: 'alien2-ws',
    });

    const foreignWs = await client.post('/api/knowledge/categories', {
      organizationId: scope.organizationId,
      workspaceId: 'wsp_alien2',
      name: 'Sneaky',
    });
    expect(foreignWs.statusCode).toBe(403);

    const foreignTenant = await client.post('/api/knowledge/categories', {
      organizationId: 'org_alien',
      workspaceId: scope.workspaceId,
      name: 'Sneaky',
    });
    expect(foreignTenant.statusCode).toBe(403);

    await client.app.close();
  });

  it('a duplicate category name in the same workspace resolves to CONFLICT (409), never a leaked 500', async () => {
    const client = await chatClient();
    const scope = await onboardOrgAndWorkspace(client);

    const first = await client.post('/api/knowledge/categories', {
      organizationId: scope.organizationId,
      workspaceId: scope.workspaceId,
      name: 'Policies',
    });
    expect(first.statusCode).toBe(201);

    // Same name, same workspace → clean 409 CONFLICT (the domain pre-check
    // fires before the unique-constraint would ever surface as a 500).
    const duplicate = await client.post('/api/knowledge/categories', {
      organizationId: scope.organizationId,
      workspaceId: scope.workspaceId,
      name: 'Policies',
    });
    expect(duplicate.statusCode).toBe(409);
    expect(duplicate.json()).toMatchObject({ error: { code: 'CONFLICT' } });

    // Zero mutation: exactly one category remains.
    const listed = await client.get(
      `/api/knowledge/categories?organizationId=${scope.organizationId}&workspaceId=${scope.workspaceId}`,
    );
    expect((listed.json() as { categories: { name: string }[] }).categories).toHaveLength(1);

    // The SAME name in a DIFFERENT workspace is allowed (scope-bound uniqueness).
    await seedWorkspace(client.repos, {
      id: 'wsp_cat2',
      organizationId: scope.organizationId,
      slug: 'cat2-ws',
    });
    await seedWorkspaceMembership(client.repos, {
      workspaceId: 'wsp_cat2',
      userId: currentUserId(client),
      role: 'owner',
      organizationId: scope.organizationId,
    });
    const otherWs = await client.post('/api/knowledge/categories', {
      organizationId: scope.organizationId,
      workspaceId: 'wsp_cat2',
      name: 'Policies',
    });
    expect(otherWs.statusCode).toBe(201);

    await client.app.close();
  });
});

describe('S18 combined retrieval (documents + articles)', () => {
  it('returns document and article citations in one query with correct kind', async () => {
    const client = await chatClient();
    const scope = await onboardOrgAndWorkspace(client);

    // Document indexed via the documents upload path.
    const doc = await client.post('/api/documents', {
      organizationId: scope.organizationId,
      workspaceId: scope.workspaceId,
      title: 'Security Handbook',
      contentType: 'text/plain',
      content: Buffer.from('MFA is required for all accounts.').toString('base64'),
    });
    expect(doc.statusCode).toBe(201);

    // Article published via the knowledge path.
    const created = await createArticle(client, scope, {
      title: 'Security Policy',
      body: 'MFA tokens expire after 60 days.',
    });
    const articleId = (created.json() as { article: { id: string } }).article.id;
    await publishArticle(client, articleId, scope);

    const refs = (
      (await search(client, scope, 'MFA')).json() as {
        references: { kind: string; version: number; documentId: string }[];
      }
    ).references;
    expect(refs).toHaveLength(2);
    const kinds = refs.map((r) => r.kind).sort();
    expect(kinds).toEqual(['article', 'document']);
    // The article citation's scopeId/documentId IS the article id.
    const articleRef = refs.find((r) => r.kind === 'article');
    expect(articleRef?.documentId).toBe(articleId);
    expect(articleRef?.version).toBe(1);

    await client.app.close();
  });
});
