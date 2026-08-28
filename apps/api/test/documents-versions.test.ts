/**
 * S17 Documents vertical slice — versioning, restore, and template API tests
 * (`fastify.inject`):
 *
 * - Uploading a new version appends a monotonic revision, replaces the
 *   current content, and refreshes the knowledge index (retrieval returns
 *   the new content; old content never leaks).
 * - Restoring a historical version creates a NEW current revision (history
 *   stays immutable) and refreshes retrieval.
 * - Templates are workspace-scoped: create/list/use/archive all flow through
 *   the trusted membership authorization, and foreign workspace/tenant
 *   access resolves to 403/404.
 * - Forged ids (document, version, template) and cross-workspace access fail
 *   closed — the model can never widen scope.
 */

import { describe, expect, it } from 'vitest';

import {
  chatClient,
  currentUserId,
  onboardOrgAndWorkspace,
  seedDocumentAndKnowledge,
  seedDocumentTemplate,
  seedDocumentVersion,
  seedWorkspace,
  seedWorkspaceMembership,
  type ChatClient,
} from './helpers.js';

/** Uploads a plain-text document and returns the created document. */
async function uploadDocument(
  client: ChatClient,
  scope: { organizationId: string; workspaceId: string },
  title: string,
  text: string,
) {
  return client.post('/api/documents', {
    organizationId: scope.organizationId,
    workspaceId: scope.workspaceId,
    title,
    contentType: 'text/plain',
    content: Buffer.from(text).toString('base64'),
  });
}

describe('S17 document versions (API)', () => {
  it('uploads a new version: monotonic revision, current content replaced, index refreshed', async () => {
    const client = await chatClient();
    const scope = await onboardOrgAndWorkspace(client, { workspaceType: 'legal' });

    const created = await uploadDocument(
      client,
      scope,
      'roadmap.txt',
      'The roadmap deadline is June 30.',
    );
    expect(created.statusCode).toBe(201);
    const documentId = (created.json() as { document: { id: string } }).document.id;

    // v1 is recorded at upload.
    const initialHistory = await client.get(
      `/api/documents/${documentId}/versions?organizationId=${scope.organizationId}&workspaceId=${scope.workspaceId}`,
    );
    const initialVersions = (initialHistory.json() as { versions: { version: number }[] }).versions;
    expect(initialVersions.map((v) => v.version)).toEqual([1]);

    // Upload v2 with different content.
    const updated = await client.post(`/api/documents/${documentId}/versions`, {
      organizationId: scope.organizationId,
      workspaceId: scope.workspaceId,
      contentType: 'text/plain',
      content: Buffer.from('The revised roadmap deadline is September 1.').toString('base64'),
    });
    expect(updated.statusCode).toBe(201);
    const updatedBody = updated.json() as { versionNumber: number; indexed: boolean };
    expect(updatedBody.versionNumber).toBe(2);
    expect(updatedBody.indexed).toBe(true);

    // Retrieval returns the NEW content — the old deadline never answers.
    const search = await client.get(
      `/api/knowledge/search?organizationId=${scope.organizationId}&workspaceId=${scope.workspaceId}&q=${encodeURIComponent('deadline')}`,
    );
    const refs = (search.json() as { references: { snippet: string }[] }).references;
    expect(refs[0]?.snippet).toContain('September 1');
    expect(refs[0]?.snippet).not.toContain('June 30');

    // Version history has both revisions; content per version is retrievable.
    const history = await client.get(
      `/api/documents/${documentId}/versions?organizationId=${scope.organizationId}&workspaceId=${scope.workspaceId}`,
    );
    expect((history.json() as { versions: unknown[] }).versions).toHaveLength(2);

    const v1Content = await client.get(
      `/api/documents/${documentId}/versions/1/content?organizationId=${scope.organizationId}&workspaceId=${scope.workspaceId}`,
    );
    expect(v1Content.statusCode).toBe(200);
    const v1Body = v1Content.json() as { content: string };
    expect(Buffer.from(v1Body.content, 'base64').toString('utf8')).toContain('June 30');

    await client.app.close();
  });

  it('restores a historical version as a NEW revision and refreshes retrieval', async () => {
    const client = await chatClient();
    const scope = await onboardOrgAndWorkspace(client, { workspaceType: 'legal' });

    const created = await uploadDocument(client, scope, 'plan.txt', 'Deadline June 30.');
    const documentId = (created.json() as { document: { id: string } }).document.id;
    await client.post(`/api/documents/${documentId}/versions`, {
      organizationId: scope.organizationId,
      workspaceId: scope.workspaceId,
      contentType: 'text/plain',
      content: Buffer.from('Deadline September 1.').toString('base64'),
    });

    // Restore v1 → v3 with the v1 content, history v1/v2 untouched.
    const restored = await client.post(`/api/documents/${documentId}/versions/1/restore`, {
      organizationId: scope.organizationId,
      workspaceId: scope.workspaceId,
    });
    expect(restored.statusCode).toBe(200);
    const restoredBody = restored.json() as {
      versionNumber: number;
      restoredFromVersion: number;
      indexed: boolean;
    };
    expect(restoredBody.versionNumber).toBe(3);
    expect(restoredBody.restoredFromVersion).toBe(1);
    expect(restoredBody.indexed).toBe(true);

    const history = await client.get(
      `/api/documents/${documentId}/versions?organizationId=${scope.organizationId}&workspaceId=${scope.workspaceId}`,
    );
    const versions = (
      history.json() as { versions: { version: number; restoredFromVersion?: number }[] }
    ).versions;
    expect(versions.map((v) => v.version)).toEqual([1, 2, 3]);
    expect(versions[0]?.restoredFromVersion).toBeUndefined();
    expect(versions[1]?.restoredFromVersion).toBeUndefined();
    expect(versions[2]?.restoredFromVersion).toBe(1);

    // Retrieval reflects the restored (v1) content.
    const search = await client.get(
      `/api/knowledge/search?organizationId=${scope.organizationId}&workspaceId=${scope.workspaceId}&q=deadline`,
    );
    const refs = (search.json() as { references: { snippet: string }[] }).references;
    expect(refs[0]?.snippet).toContain('June 30');

    await client.app.close();
  });

  it('rejects forged/foreign document version access (isolation)', async () => {
    const client = await chatClient();
    const scope = await onboardOrgAndWorkspace(client, { workspaceType: 'legal' });

    // A document in a DIFFERENT workspace of the same org, where the caller
    // IS a member — reading its history through the OTHER workspace 404s.
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
      title: 'Private Plan',
      text: 'Secret content.',
    });
    await seedDocumentVersion(client.repos, {
      documentId: 'doc_11111111-1111-4111-8111-111111111111',
      organizationId: scope.organizationId,
      workspaceId: 'wsp_secret',
      version: 1,
      contentRef: 'doc/doc_11111111-1111-4111-8111-111111111111/v1',
      createdBy: userId,
    });

    // Foreign workspace: NOT FOUND (the document is not visible here).
    const foreign = await client.get(
      `/api/documents/doc_11111111-1111-4111-8111-111111111111/versions?organizationId=${scope.organizationId}&workspaceId=${scope.workspaceId}`,
    );
    expect(foreign.statusCode).toBe(404);

    // Foreign tenant: forbidden.
    const foreignTenant = await client.get(
      `/api/documents/doc_11111111-1111-4111-8111-111111111111/versions?organizationId=org_alien&workspaceId=${scope.workspaceId}`,
    );
    expect(foreignTenant.statusCode).toBe(403);

    // Forged document id: NOT FOUND.
    const forged = await client.get(
      `/api/documents/doc_99999999-9999-4999-8999-999999999999/versions?organizationId=${scope.organizationId}&workspaceId=${scope.workspaceId}`,
    );
    expect(forged.statusCode).toBe(404);

    await client.app.close();
  });

  it('rejects a version upload and a restore from a foreign workspace', async () => {
    const client = await chatClient();
    const scope = await onboardOrgAndWorkspace(client, { workspaceType: 'legal' });

    const created = await uploadDocument(client, scope, 'plan.txt', 'Content.');
    const documentId = (created.json() as { document: { id: string } }).document.id;

    await seedWorkspace(client.repos, {
      id: 'wsp_other',
      organizationId: scope.organizationId,
      slug: 'other-ws',
    });

    const versionUpload = await client.post(`/api/documents/${documentId}/versions`, {
      organizationId: scope.organizationId,
      workspaceId: 'wsp_other',
      contentType: 'text/plain',
      content: Buffer.from('sneaky').toString('base64'),
    });
    expect(versionUpload.statusCode).toBe(403);

    const restore = await client.post(`/api/documents/${documentId}/versions/1/restore`, {
      organizationId: scope.organizationId,
      workspaceId: 'wsp_other',
    });
    expect(restore.statusCode).toBe(403);

    await client.app.close();
  });
});

describe('S17 document templates (API)', () => {
  it('creates, lists, uses, and archives templates within the workspace', async () => {
    const client = await chatClient();
    const scope = await onboardOrgAndWorkspace(client, { workspaceType: 'legal' });

    const created = await client.post('/api/documents/templates', {
      organizationId: scope.organizationId,
      workspaceId: scope.workspaceId,
      name: 'Quarterly Plan',
      description: 'Starter',
      contentType: 'text/markdown',
      content: Buffer.from('# Quarterly Plan\nThe launch window opens in May.').toString('base64'),
    });
    expect(created.statusCode).toBe(201);
    const templateId = (created.json() as { template: { id: string } }).template.id;

    const listed = await client.get(
      `/api/documents/templates?organizationId=${scope.organizationId}&workspaceId=${scope.workspaceId}`,
    );
    expect(listed.statusCode).toBe(200);
    expect((listed.json() as { templates: { name: string }[] }).templates).toMatchObject([
      { name: 'Quarterly Plan' },
    ]);

    // Use the template to create a document (indexed like a manual upload).
    const used = await client.post('/api/documents/from-template', {
      organizationId: scope.organizationId,
      workspaceId: scope.workspaceId,
      templateId,
      title: 'Q3 Plan',
    });
    expect(used.statusCode).toBe(201);
    const usedBody = used.json() as { document: { status: string }; indexed: boolean };
    expect(usedBody.document.status).toBe('available');
    expect(usedBody.indexed).toBe(true);

    // The created document is retrievable.
    const search = await client.get(
      `/api/knowledge/search?organizationId=${scope.organizationId}&workspaceId=${scope.workspaceId}&q=launch`,
    );
    expect((search.json() as { references: unknown[] }).references).toHaveLength(1);

    // Archive removes it from the picker.
    const archived = await client.post(`/api/documents/templates/${templateId}/archive`, {
      organizationId: scope.organizationId,
      workspaceId: scope.workspaceId,
    });
    expect(archived.statusCode).toBe(200);
    const after = await client.get(
      `/api/documents/templates?organizationId=${scope.organizationId}&workspaceId=${scope.workspaceId}`,
    );
    expect((after.json() as { templates: unknown[] }).templates).toEqual([]);

    await client.app.close();
  });

  it('enforces template scope isolation (foreign workspace and tenant)', async () => {
    const client = await chatClient();
    const scope = await onboardOrgAndWorkspace(client, { workspaceType: 'legal' });
    const userId = currentUserId(client);

    // Seed a template into a workspace the caller is NOT a member of.
    await seedWorkspace(client.repos, {
      id: 'wsp_alien',
      organizationId: scope.organizationId,
      slug: 'alien-ws',
    });
    const alien = await seedDocumentTemplate(client.repos, {
      id: 'tpl_alien',
      organizationId: scope.organizationId,
      workspaceId: 'wsp_alien',
      createdBy: userId,
      name: 'Alien Template',
      contentRef: 'tpl/alien/v1',
    });

    // The picker only shows the caller's workspace templates.
    const listed = await client.get(
      `/api/documents/templates?organizationId=${scope.organizationId}&workspaceId=${scope.workspaceId}`,
    );
    expect((listed.json() as { templates: unknown[] }).templates).toEqual([]);

    // Archiving a foreign-workspace template resolves to NOT FOUND.
    const archive = await client.post(`/api/documents/templates/${alien.id}/archive`, {
      organizationId: scope.organizationId,
      workspaceId: scope.workspaceId,
    });
    expect(archive.statusCode).toBe(404);

    // Using it is equally denied.
    const use = await client.post('/api/documents/from-template', {
      organizationId: scope.organizationId,
      workspaceId: scope.workspaceId,
      templateId: alien.id,
      title: 'Sneaky',
    });
    expect(use.statusCode).toBe(404);

    await client.app.close();
  });
});
