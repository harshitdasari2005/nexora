/**
 * Documents + Knowledge vertical slice — API tests (`fastify.inject`):
 *
 * - Upload persists metadata, runs processing (extraction → available), and
 *   indexes the extracted text into Knowledge.
 * - List/get are workspace-scoped; foreign workspace and foreign tenant
 *   resolve to 403/404, never to another tenant's record.
 * - Archive removes the document and its knowledge index entry.
 * - Authorization is membership-based (organization + workspace), and a
 *   non-member can neither read nor upload.
 */

import { describe, expect, it } from 'vitest';

import {
  chatClient,
  onboardOrgAndWorkspace,
  seedDocumentAndKnowledge,
  seedWorkspace,
  seedWorkspaceMembership,
  currentUserId,
} from './helpers.js';

/** Uploads a plain-text document and returns the created document. */
async function uploadDocument(
  client: Awaited<ReturnType<typeof chatClient>>,
  scope: { organizationId: string; workspaceId: string },
  title: string,
  text: string,
) {
  const response = await client.post('/api/documents', {
    organizationId: scope.organizationId,
    workspaceId: scope.workspaceId,
    title,
    contentType: 'text/plain',
    content: Buffer.from(text).toString('base64'),
  });
  return response;
}

describe('document routes (Documents + Knowledge vertical slice)', () => {
  it('uploads a document, processes it to available, and indexes it into knowledge', async () => {
    const client = await chatClient();
    const scope = await onboardOrgAndWorkspace(client, { workspaceType: 'legal' });

    const response = await uploadDocument(
      client,
      scope,
      'Mobile Banking Project Plan.txt',
      'The Mobile Banking project deadline is June 30. The launch window opens in May.',
    );
    expect(response.statusCode).toBe(201);
    const body = response.json() as {
      document: { id: string; title: string; status: string; contentVersion: number };
      indexed: boolean;
    };
    expect(body.document.title).toBe('Mobile Banking Project Plan.txt');
    expect(body.document.status).toBe('available');
    expect(body.document.contentVersion).toBe(2); // uploaded + processed
    expect(body.indexed).toBe(true);

    // The document is now retrievable through the permission-filtered
    // knowledge search (same workspace, same user).
    const search = await client.get(
      `/api/knowledge/search?organizationId=${scope.organizationId}&workspaceId=${scope.workspaceId}&q=${encodeURIComponent('deadline')}`,
    );
    expect(search.statusCode).toBe(200);
    const refs = (search.json() as { references: { title: string; snippet: string }[] }).references;
    expect(refs).toHaveLength(1);
    expect(refs[0]?.title).toBe('Mobile Banking Project Plan.txt');
    expect(refs[0]?.snippet).toContain('June 30');

    // List shows the document.
    const list = await client.get(
      `/api/documents?organizationId=${scope.organizationId}&workspaceId=${scope.workspaceId}`,
    );
    expect(list.statusCode).toBe(200);
    expect((list.json() as { documents: unknown[] }).documents).toHaveLength(1);

    await client.app.close();
  });

  it('reports an honest failed state when extraction yields no text and never indexes', async () => {
    const client = await chatClient();
    const scope = await onboardOrgAndWorkspace(client, { workspaceType: 'legal' });

    // application/pdf with no extractable text → failed (never fake success).
    const response = await client.post('/api/documents', {
      organizationId: scope.organizationId,
      workspaceId: scope.workspaceId,
      title: 'broken.pdf',
      contentType: 'application/pdf',
      content: Buffer.from('%%PDF-1.4 not a real pdf').toString('base64'),
    });
    expect(response.statusCode).toBe(201);
    const body = response.json() as {
      document: { status: string; failureReason?: string };
      indexed: boolean;
    };
    expect(body.document.status).toBe('failed');
    expect(body.indexed).toBe(false);

    const search = await client.get(
      `/api/knowledge/search?organizationId=${scope.organizationId}&workspaceId=${scope.workspaceId}&q=broken`,
    );
    expect((search.json() as { references: unknown[] }).references).toHaveLength(0);

    await client.app.close();
  });

  it('rejects a document upload from a workspace the caller is not a member of', async () => {
    const client = await chatClient();
    const scope = await onboardOrgAndWorkspace(client, { workspaceType: 'legal' });

    // A workspace in the same organization where the caller has NO
    // membership → the upload is forbidden (workspace scope).
    await seedWorkspace(client.repos, {
      id: 'wsp_other',
      organizationId: scope.organizationId,
      slug: 'other-ws',
    });
    const response = await uploadDocument(client, scope, 'sneaky.txt', 'secret');
    const forged = await client.post('/api/documents', {
      organizationId: scope.organizationId,
      workspaceId: 'wsp_other',
      title: 'sneaky.txt',
      contentType: 'text/plain',
      content: Buffer.from('secret').toString('base64'),
    });
    expect(forged.statusCode).toBe(403);
    expect(forged.json()).toMatchObject({ error: { code: 'AUTHORIZATION_ERROR' } });
    // The original upload in the member workspace still succeeded.
    expect(response.statusCode).toBe(201);
    await client.app.close();
  });

  it('rejects reading documents from a foreign workspace (403) and a foreign tenant (403)', async () => {
    const client = await chatClient();
    const scope = await onboardOrgAndWorkspace(client, { workspaceType: 'legal' });

    const foreignWorkspace = await client.get(
      `/api/documents?organizationId=${scope.organizationId}&workspaceId=wsp_alien`,
    );
    expect(foreignWorkspace.statusCode).toBe(403);

    const foreignTenant = await client.get(
      `/api/documents?organizationId=org_alien&workspaceId=${scope.workspaceId}`,
    );
    expect(foreignTenant.statusCode).toBe(403);

    await client.app.close();
  });

  it('never leaks a foreign document id (resolves to NOT FOUND)', async () => {
    const client = await chatClient();
    const scope = await onboardOrgAndWorkspace(client, { workspaceType: 'legal' });

    // Seed a document into a DIFFERENT workspace of the same organization.
    const userId = currentUserId(client);
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
    await seedDocumentAndKnowledge(client.repos, {
      id: 'doc_11111111-1111-4111-8111-111111111111',
      organizationId: scope.organizationId,
      workspaceId: 'wsp_secret',
      uploaderId: userId,
      title: 'Private HR Document',
      text: 'The private HR salary band is strictly confidential.',
    });

    // The caller IS a member of wsp_secret now, but the document id alone is
    // NOT enough: reading it through the OTHER workspace must 404.
    const read = await client.get(
      `/api/documents/doc_11111111-1111-4111-8111-111111111111?organizationId=${scope.organizationId}&workspaceId=${scope.workspaceId}`,
    );
    expect(read.statusCode).toBe(404);

    // And the knowledge search in the member workspace never surfaces it.
    const search = await client.get(
      `/api/knowledge/search?organizationId=${scope.organizationId}&workspaceId=${scope.workspaceId}&q=${encodeURIComponent('confidential')}`,
    );
    expect((search.json() as { references: unknown[] }).references).toHaveLength(0);

    await client.app.close();
  });

  it('archives a document and removes it from the knowledge index', async () => {
    const client = await chatClient();
    const scope = await onboardOrgAndWorkspace(client, { workspaceType: 'legal' });

    const created = await uploadDocument(
      client,
      scope,
      'archived-plan.txt',
      'The archived plan deadline is December 1.',
    );
    const documentId = (created.json() as { document: { id: string } }).document.id;

    const archived = await client.post(`/api/documents/${documentId}/archive`, {
      organizationId: scope.organizationId,
      workspaceId: scope.workspaceId,
    });
    expect(archived.statusCode).toBe(200);
    expect((archived.json() as { document: { status: string } }).document.status).toBe('archived');

    const search = await client.get(
      `/api/knowledge/search?organizationId=${scope.organizationId}&workspaceId=${scope.workspaceId}&q=archived`,
    );
    expect((search.json() as { references: unknown[] }).references).toHaveLength(0);

    // A foreign user cannot archive it.
    const denied = await client.post(`/api/documents/${documentId}/archive`, {
      organizationId: 'org_alien',
      workspaceId: scope.workspaceId,
    });
    expect(denied.statusCode).toBe(403);

    await client.app.close();
  });

  it('rejects unauthenticated document access with 401', async () => {
    const client = await chatClient();
    const response = await client.app.inject({ method: 'GET', url: '/api/documents' });
    expect(response.statusCode).toBe(401);
    await client.app.close();
  });
});
