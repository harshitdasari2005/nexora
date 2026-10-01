/**
 * Documents application service tests: the upload pipeline (storage →
 * metadata → processing → available/failed), the archive flow, event
 * publishing, and workspace-scoped reads (a foreign document id resolves to
 * NOT FOUND — workspace isolation at the application boundary).
 */

import { describe, expect, it, vi } from 'vitest';
import type { TenantId, UserId, WorkspaceId } from '@nexora/contracts/common';
import type { EventEnvelope, EventPublisher } from '@nexora/shared/events';

import {
  DocumentDomainService,
  DocumentNotFoundError,
  type Document,
  type DocumentRepository,
  type DocumentTemplate,
  type DocumentTemplateRepository,
  type DocumentVersion,
  type DocumentVersionRepository,
} from '@nexora/domain-documents';
import {
  DefaultDocumentTextExtractor,
  DocumentApplicationService,
  DocumentExtractionError,
  InMemoryDocumentStorage,
  type DocumentStorage,
  type DocumentTextExtractor,
} from '../src/index.js';

const TENANT = 'org_acme' as TenantId;
const WORKSPACE = 'wsp_engineering' as WorkspaceId;
const WORKSPACE_B = 'wsp_other' as WorkspaceId;
const UPLOADER = 'usr_alice' as UserId;

/** An in-memory {@link DocumentVersionRepository} (immutable history). */
class InMemoryDocumentVersionRepository implements DocumentVersionRepository {
  readonly versions = new Map<string, DocumentVersion>();

  async listByDocument(documentId: string): Promise<readonly DocumentVersion[]> {
    return [...this.versions.values()]
      .filter((version) => version.documentId === documentId)
      .sort((a, b) => a.version - b.version);
  }

  async findByDocumentAndVersion(
    documentId: string,
    version: number,
  ): Promise<DocumentVersion | undefined> {
    return [...this.versions.values()].find(
      (record) => record.documentId === documentId && record.version === version,
    );
  }

  async save(version: DocumentVersion): Promise<void> {
    this.versions.set(version.id, version);
  }
}

/** An in-memory {@link DocumentTemplateRepository}. */
class InMemoryDocumentTemplateRepository implements DocumentTemplateRepository {
  readonly templates = new Map<string, DocumentTemplate>();

  async findById(templateId: string): Promise<DocumentTemplate | undefined> {
    return this.templates.get(templateId);
  }

  async listActiveByWorkspace(
    organizationId: TenantId,
    workspaceId: WorkspaceId,
  ): Promise<readonly DocumentTemplate[]> {
    return [...this.templates.values()].filter(
      (template) =>
        template.organizationId === organizationId &&
        template.workspaceId === workspaceId &&
        template.isActive(),
    );
  }

  async save(template: DocumentTemplate): Promise<void> {
    this.templates.set(template.id, template);
  }
}

/** An in-memory {@link DocumentRepository} (matches the fake used in API tests). */
class InMemoryDocumentRepository implements DocumentRepository {
  readonly documents = new Map<string, Document>();

  async findById(id: string): Promise<Document | undefined> {
    return this.documents.get(id);
  }

  async listByWorkspace(
    organizationId: TenantId,
    workspaceId: WorkspaceId,
  ): Promise<readonly Document[]> {
    return [...this.documents.values()]
      .filter(
        (document) =>
          document.organizationId === organizationId && document.workspaceId === workspaceId,
      )
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async save(document: Document): Promise<void> {
    this.documents.set(document.id, document);
  }
}

function recordingPublisher(): EventPublisher & { published: readonly EventEnvelope[] } {
  const published: EventEnvelope[] = [];
  return {
    published,
    publish: vi.fn(async (events: readonly EventEnvelope[]) => {
      published.push(...events);
    }),
  } as unknown as EventPublisher & { published: readonly EventEnvelope[] };
}

function buildService(
  options: {
    documents?: InMemoryDocumentRepository;
    versions?: InMemoryDocumentVersionRepository;
    templates?: InMemoryDocumentTemplateRepository;
    storage?: DocumentStorage;
    extractor?: DocumentTextExtractor;
    publisher?: EventPublisher & { published: readonly EventEnvelope[] };
  } = {},
) {
  const documents = options.documents ?? new InMemoryDocumentRepository();
  const versions = options.versions ?? new InMemoryDocumentVersionRepository();
  const templates = options.templates ?? new InMemoryDocumentTemplateRepository();
  const storage = options.storage ?? new InMemoryDocumentStorage();
  const extractor = options.extractor ?? new DefaultDocumentTextExtractor();
  const publisher = options.publisher ?? recordingPublisher();
  const service = new DocumentApplicationService({
    documentsService: new DocumentDomainService({ documents, versions, templates }),
    documents,
    storage,
    extractor,
    publisher,
  });
  return { service, documents, versions, templates, storage, extractor, publisher };
}

function uploadCommand(
  overrides: Partial<Parameters<DocumentApplicationService['uploadDocument']>[0]> = {},
) {
  return {
    organizationId: TENANT,
    workspaceId: WORKSPACE,
    uploaderId: UPLOADER,
    title: 'Mobile Banking Project Plan',
    contentType: 'text/plain',
    content: Buffer.from('The Mobile Banking project deadline is June 30.'),
    correlationId: 'corr_1',
    ...overrides,
  };
}

describe('DocumentApplicationService.uploadDocument', () => {
  it('stores content, walks the lifecycle to available, and publishes events', async () => {
    const { service, documents, storage, publisher } = buildService();
    const result = await service.uploadDocument(uploadCommand());

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.document.status.value).toBe('available');
    expect(result.value.document.contentVersion).toBe(2);
    expect(result.value.extractedText).toContain('deadline is June 30');

    // Content lives in storage, metadata in the repository.
    const stored = [...(storage as InMemoryDocumentStorage).contents.entries()];
    expect(stored.length).toBe(1);
    expect(stored[0]![0]).toMatch(/^doc\//);
    const persisted = documents.documents.get(result.value.document.id);
    expect(persisted?.status.value).toBe('available');
    expect(persisted?.contentRef.value).toBe(stored[0]![0]);

    // Events: uploaded → processing_started → available.
    const types = publisher.published.map((event) => event.type);
    expect(types).toEqual([
      'document.uploaded',
      'document.processing_started',
      'document.available',
    ]);
  });

  it('marks the document failed (never searchable) when extraction fails', async () => {
    const extractor = {
      extract: vi.fn(async () => {
        throw new DocumentExtractionError('PDF extraction is not available');
      }),
    } as unknown as DocumentTextExtractor;
    const { service, publisher } = buildService({ extractor });

    const result = await service.uploadDocument(uploadCommand());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.document.status.value).toBe('failed');
    expect(result.value.document.failureReason).toContain('PDF extraction');
    expect(result.value.extractedText).toBeUndefined();
    expect(publisher.published.map((event) => event.type)).toEqual([
      'document.uploaded',
      'document.processing_started',
      'document.processing_failed',
    ]);
  });

  it('leaves NO metadata record when storage fails (no partial state)', async () => {
    const storage = {
      store: vi.fn(async () => {
        throw new Error('storage unavailable');
      }),
      load: vi.fn(async () => undefined),
      remove: vi.fn(async () => undefined),
    } as unknown as DocumentStorage;
    const { service, documents, publisher } = buildService({ storage });

    const result = await service.uploadDocument(uploadCommand());
    expect(result.ok).toBe(false);
    expect(documents.documents.size).toBe(0);
    expect(publisher.published).toEqual([]);
  });

  it('extracts text from a minimal PDF (FlateDecode + Tj)', async () => {
    // Build a minimal PDF with one FlateDecode stream containing `(June 30) Tj`.
    const { deflateSync } = await import('node:zlib');
    const contentStream = deflateSync(
      Buffer.from('BT /F1 12 Tf 72 720 Td (June 30) Tj ET', 'latin1'),
    );
    const pdf = Buffer.from(
      '%PDF-1.4\n1 0 obj\n<< /Length ' +
        contentStream.length +
        ' /Filter /FlateDecode >>\nstream\n' +
        contentStream.toString('latin1') +
        '\nendstream\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF',
      'latin1',
    );

    const { service } = buildService();
    const result = await service.uploadDocument(
      uploadCommand({ title: 'Plan', contentType: 'application/pdf', content: pdf }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.document.status.value).toBe('available');
    expect(result.value.extractedText).toContain('June 30');
  });
});

describe('DocumentApplicationService.archiveDocument', () => {
  it('archives a visible document, removes content, and publishes', async () => {
    const { service, storage, publisher } = buildService();
    const uploaded = await service.uploadDocument(uploadCommand());
    expect(uploaded.ok).toBe(true);
    if (!uploaded.ok) return;
    const contentKey = uploaded.value.document.contentRef.value;
    expect((storage as InMemoryDocumentStorage).contents.has(contentKey)).toBe(true);

    const archived = await service.archiveDocument({
      organizationId: TENANT,
      workspaceId: WORKSPACE,
      actorId: UPLOADER,
      documentId: uploaded.value.document.id,
      correlationId: 'corr_2',
    });
    expect(archived.ok).toBe(true);
    if (!archived.ok) return;
    expect(archived.value.document.status.value).toBe('archived');
    expect((storage as InMemoryDocumentStorage).contents.has(contentKey)).toBe(false);
    expect(publisher.published.map((event) => event.type)).toContain('document.archived');
  });

  it('resolves a foreign-workspace document to NOT FOUND (workspace isolation)', async () => {
    const { service } = buildService();
    const uploaded = await service.uploadDocument(uploadCommand());
    expect(uploaded.ok).toBe(true);
    if (!uploaded.ok) return;

    const foreign = await service.archiveDocument({
      organizationId: TENANT,
      workspaceId: WORKSPACE_B, // different workspace
      actorId: UPLOADER,
      documentId: uploaded.value.document.id,
      correlationId: 'corr_3',
    });
    expect(foreign.ok).toBe(false);
    if (foreign.ok) return;
    expect(foreign.error instanceof DocumentNotFoundError).toBe(true);
  });

  it('resolves a forged document id to NOT FOUND', async () => {
    const { service } = buildService();
    const archived = await service.archiveDocument({
      organizationId: TENANT,
      workspaceId: WORKSPACE,
      actorId: UPLOADER,
      documentId: 'doc_forged',
      correlationId: 'corr_4',
    });
    expect(archived.ok).toBe(false);
  });
});

describe('DocumentApplicationService reads', () => {
  it('lists only the documents of the trusted workspace', async () => {
    const { service } = buildService();
    await service.uploadDocument(uploadCommand());
    await service.uploadDocument(uploadCommand({ title: 'Secret', workspaceId: WORKSPACE_B }));

    const listed = await service.listDocumentsByWorkspace(TENANT, WORKSPACE);
    expect(listed.ok).toBe(true);
    if (!listed.ok) return;
    expect(listed.value.map((document) => document.title)).toEqual(['Mobile Banking Project Plan']);
  });

  it('never returns a foreign-workspace document by id', async () => {
    const { service } = buildService();
    const uploaded = await service.uploadDocument(uploadCommand());
    expect(uploaded.ok).toBe(true);
    if (!uploaded.ok) return;

    const foreign = await service.getDocument(TENANT, WORKSPACE_B, uploaded.value.document.id);
    expect(foreign.ok).toBe(false);
  });
});

describe('DocumentApplicationService.uploadDocumentVersion (S17 versioning)', () => {
  async function uploadedDocument(service: DocumentApplicationService) {
    const uploaded = await service.uploadDocument(uploadCommand());
    expect(uploaded.ok).toBe(true);
    if (!uploaded.ok) throw new Error('upload failed');
    return uploaded.value;
  }

  it('records v1 on upload, then appends a monotonic v2 on new content', async () => {
    const { service, versions, publisher } = buildService();
    const initial = await uploadedDocument(service);

    const history = await versions.listByDocument(initial.document.id);
    expect(history.map((record) => record.version)).toEqual([1]);
    expect(history[0]?.contentRef.value).toBe(initial.document.contentRef.value);

    const updated = await service.uploadDocumentVersion({
      organizationId: TENANT,
      workspaceId: WORKSPACE,
      actorId: UPLOADER,
      documentId: initial.document.id,
      contentType: 'text/plain',
      content: Buffer.from('The revised deadline is August 15.'),
      correlationId: 'corr_v2',
    });
    expect(updated.ok).toBe(true);
    if (!updated.ok) return;
    expect(updated.value.versionNumber).toBe(2);
    expect(updated.value.document.contentRef.value).toContain('/v2');
    expect(updated.value.extractedText).toContain('August 15');

    const after = await versions.listByDocument(initial.document.id);
    expect(after.map((record) => record.version)).toEqual([1, 2]);
    expect(after[1]?.contentRef.value).toBe(updated.value.document.contentRef.value);

    // The authoritative content-change event was emitted.
    expect(publisher.published.map((event) => event.type)).toContain('document.version_uploaded');
  });

  it('does not corrupt the current revision when the new content is not processable', async () => {
    const { service, versions, publisher } = buildService();
    const initial = await uploadedDocument(service);

    const failed = await service.uploadDocumentVersion({
      organizationId: TENANT,
      workspaceId: WORKSPACE,
      actorId: UPLOADER,
      documentId: initial.document.id,
      contentType: 'application/pdf',
      content: Buffer.from('not a pdf'),
      correlationId: 'corr_bad',
    });
    expect(failed.ok).toBe(false);

    const reloaded = await service.getDocument(TENANT, WORKSPACE, initial.document.id);
    expect(reloaded.ok).toBe(true);
    if (!reloaded.ok) return;
    expect(reloaded.value.contentVersion).toBe(initial.document.contentVersion);
    expect(reloaded.value.status).toBe('available');

    // No mutation and no history appended: exactly v1 remains.
    const history = await versions.listByDocument(initial.document.id);
    expect(history.map((record) => record.version)).toEqual([1]);
    expect(publisher.published.some((event) => event.type === 'document.version_uploaded')).toBe(
      false,
    );
  });

  it('rejects a version upload for a foreign-workspace document (isolation)', async () => {
    const { service } = buildService();
    const initial = await uploadedDocument(service);

    const foreign = await service.uploadDocumentVersion({
      organizationId: TENANT,
      workspaceId: WORKSPACE_B,
      actorId: UPLOADER,
      documentId: initial.document.id,
      contentType: 'text/plain',
      content: Buffer.from('sneaky'),
      correlationId: 'corr_forge',
    });
    expect(foreign.ok).toBe(false);
    if (foreign.ok) return;
    expect(foreign.error instanceof DocumentNotFoundError).toBe(true);
  });
});

describe('DocumentApplicationService.restoreDocumentVersion (S17 restore)', () => {
  async function seededDocument(service: DocumentApplicationService) {
    const initial = await service.uploadDocument(uploadCommand());
    expect(initial.ok).toBe(true);
    if (!initial.ok) throw new Error('upload failed');
    const updated = await service.uploadDocumentVersion({
      organizationId: TENANT,
      workspaceId: WORKSPACE,
      actorId: UPLOADER,
      documentId: initial.value.document.id,
      contentType: 'text/plain',
      content: Buffer.from('The revised deadline is August 15.'),
      correlationId: 'corr_v2',
    });
    expect(updated.ok).toBe(true);
    if (!updated.ok) throw new Error('version upload failed');
    return updated.value;
  }

  it('restores v1 as a NEW v3: history stays immutable, current content changes', async () => {
    const { service, versions, storage, publisher } = buildService();
    const updated = await seededDocument(service);
    const documentId = updated.document.id;

    const restored = await service.restoreDocumentVersion({
      organizationId: TENANT,
      workspaceId: WORKSPACE,
      actorId: UPLOADER,
      documentId,
      version: 1,
      correlationId: 'corr_restore',
    });
    expect(restored.ok).toBe(true);
    if (!restored.ok) return;
    expect(restored.value.versionNumber).toBe(3);
    expect(restored.value.restoredFromVersion).toBe(1);
    expect(restored.value.extractedText).toContain('deadline is June 30');

    // History: v1 and v2 are UNTOUCHED; v3 is the new copy (restoredFrom 1).
    const history = await versions.listByDocument(documentId);
    expect(history.map((record) => record.version)).toEqual([1, 2, 3]);
    expect(history[0]?.restoredFromVersion).toBeUndefined();
    expect(history[1]?.restoredFromVersion).toBeUndefined();
    expect(history[2]?.restoredFromVersion).toBe(1);
    expect(history[2]?.contentRef.value).toBe(restored.value.document.contentRef.value);
    expect(history[0]?.contentRef.value).not.toBe(history[2]?.contentRef.value);

    // The restored bytes were copied forward into a NEW storage key.
    const storedKeys = [...(storage as InMemoryDocumentStorage).contents.keys()];
    expect(storedKeys).toContain(history[0]?.contentRef.value);
    expect(storedKeys).toContain(history[2]?.contentRef.value);

    // The authoritative restore event was emitted.
    expect(publisher.published.map((event) => event.type)).toContain('document.version_restored');
  });

  it('resolves an invalid (document, version) combination to NOT FOUND', async () => {
    const { service } = buildService();
    const updated = await seededDocument(service);

    const invalid = await service.restoreDocumentVersion({
      organizationId: TENANT,
      workspaceId: WORKSPACE,
      actorId: UPLOADER,
      documentId: updated.document.id,
      version: 99,
      correlationId: 'corr_bad',
    });
    expect(invalid.ok).toBe(false);
    if (invalid.ok) return;
    expect(invalid.error.code).toBe('NOT_FOUND');
  });

  it('never restores a foreign-workspace document version (isolation)', async () => {
    const { service } = buildService();
    const updated = await seededDocument(service);

    const foreign = await service.restoreDocumentVersion({
      organizationId: TENANT,
      workspaceId: WORKSPACE_B,
      actorId: UPLOADER,
      documentId: updated.document.id,
      version: 1,
      correlationId: 'corr_forge',
    });
    expect(foreign.ok).toBe(false);
  });

  it('lists versions only for visible documents (foreign workspace resolves NOT FOUND)', async () => {
    const { service } = buildService();
    const updated = await seededDocument(service);

    const foreign = await service.listDocumentVersions(TENANT, WORKSPACE_B, updated.document.id);
    expect(foreign.ok).toBe(false);

    const visible = await service.listDocumentVersions(TENANT, WORKSPACE, updated.document.id);
    expect(visible.ok).toBe(true);
    if (!visible.ok) return;
    // The seeded document has v1 (initial) + v2 (new version) — no restore yet.
    expect(visible.value.map((record) => record.version)).toEqual([1, 2]);
  });

  it('serves version content only within the trusted scope', async () => {
    const { service } = buildService();
    const updated = await seededDocument(service);

    const content = await service.getDocumentVersionContent(
      TENANT,
      WORKSPACE,
      updated.document.id,
      2,
    );
    expect(content.ok).toBe(true);
    if (!content.ok) return;
    expect(content.value.content.toString('utf8')).toContain('August 15');

    const foreign = await service.getDocumentVersionContent(
      TENANT,
      WORKSPACE_B,
      updated.document.id,
      2,
    );
    expect(foreign.ok).toBe(false);
  });

  it('an ARCHIVED document no longer serves any version content (history is not a way around archiving)', async () => {
    const { service } = buildService();
    const updated = await seededDocument(service);
    const before = await service.getDocumentVersionContent(
      TENANT,
      WORKSPACE,
      updated.document.id,
      1,
    );
    expect(before.ok).toBe(true);

    const archived = await service.archiveDocument({
      organizationId: TENANT,
      workspaceId: WORKSPACE,
      actorId: UPLOADER,
      documentId: updated.document.id,
      correlationId: 'corr_arch',
    });
    expect(archived.ok).toBe(true);

    for (const version of [1, 2]) {
      const after = await service.getDocumentVersionContent(
        TENANT,
        WORKSPACE,
        updated.document.id,
        version,
      );
      expect(after.ok, `v${version}`).toBe(false);
    }
  });
});

describe('DocumentApplicationService templates (S17)', () => {
  it('creates an active template, lists it, and archives it', async () => {
    const { service } = buildService();

    const created = await service.createDocumentTemplate({
      organizationId: TENANT,
      workspaceId: WORKSPACE,
      actorId: UPLOADER,
      name: 'Quarterly Plan',
      description: 'Starter',
      contentType: 'text/markdown',
      content: Buffer.from('# Quarterly Plan\nThe launch window opens in May.'),
      correlationId: 'corr_tpl',
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    expect(created.value.template.isActive()).toBe(true);

    const listed = await service.listDocumentTemplates(TENANT, WORKSPACE);
    expect(listed.ok).toBe(true);
    if (!listed.ok) return;
    expect(listed.value.map((template) => template.name)).toEqual(['Quarterly Plan']);

    // Archived templates leave the picker.
    const archived = await service.archiveDocumentTemplate({
      organizationId: TENANT,
      workspaceId: WORKSPACE,
      actorId: UPLOADER,
      templateId: created.value.template.id,
      correlationId: 'corr_arch',
    });
    expect(archived.ok).toBe(true);
    const after = await service.listDocumentTemplates(TENANT, WORKSPACE);
    expect(after.ok && after.value).toEqual([]);
  });

  it('templates are workspace-scoped: a foreign workspace never lists or archives them', async () => {
    const { service } = buildService();
    const created = await service.createDocumentTemplate({
      organizationId: TENANT,
      workspaceId: WORKSPACE,
      actorId: UPLOADER,
      name: 'Secret Template',
      contentType: 'text/plain',
      content: Buffer.from('confidential starter'),
      correlationId: 'corr_tpl',
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const foreignList = await service.listDocumentTemplates(TENANT, WORKSPACE_B);
    expect(foreignList.ok && foreignList.value).toEqual([]);

    const foreignArchive = await service.archiveDocumentTemplate({
      organizationId: TENANT,
      workspaceId: WORKSPACE_B,
      actorId: UPLOADER,
      templateId: created.value.template.id,
      correlationId: 'corr_forge',
    });
    expect(foreignArchive.ok).toBe(false);
    if (foreignArchive.ok) return;
    expect(foreignArchive.error.code).toBe('NOT_FOUND');
  });

  it('creates a document from a template through the same upload pipeline', async () => {
    const { service } = buildService();
    const created = await service.createDocumentTemplate({
      organizationId: TENANT,
      workspaceId: WORKSPACE,
      actorId: UPLOADER,
      name: 'Onboarding Doc',
      contentType: 'text/markdown',
      content: Buffer.from('# Onboarding\nWelcome to the team.'),
      correlationId: 'corr_tpl',
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const fromTemplate = await service.createDocumentFromTemplate({
      organizationId: TENANT,
      workspaceId: WORKSPACE,
      actorId: UPLOADER,
      templateId: created.value.template.id,
      title: 'Alex Onboarding',
      correlationId: 'corr_use',
    });
    expect(fromTemplate.ok).toBe(true);
    if (!fromTemplate.ok) return;
    expect(fromTemplate.value.document.status.value).toBe('available');
    expect(fromTemplate.value.extractedText).toContain('Welcome to the team');
  });

  it('rejects using a template from a foreign workspace (NOT FOUND)', async () => {
    const { service } = buildService();
    const created = await service.createDocumentTemplate({
      organizationId: TENANT,
      workspaceId: WORKSPACE,
      actorId: UPLOADER,
      name: 'Private Template',
      contentType: 'text/plain',
      content: Buffer.from('secret starter'),
      correlationId: 'corr_tpl',
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const foreign = await service.createDocumentFromTemplate({
      organizationId: TENANT,
      workspaceId: WORKSPACE_B,
      actorId: UPLOADER,
      templateId: created.value.template.id,
      title: 'Sneaky',
      correlationId: 'corr_forge',
    });
    expect(foreign.ok).toBe(false);
    if (foreign.ok) return;
    expect(foreign.error.code).toBe('NOT_FOUND');
  });
});

describe('PDF extraction — decompression-bomb bounds', () => {
  const pdfWith = (streams: Buffer[]): Buffer =>
    Buffer.from(
      '%PDF-1.4\n' +
        streams
          .map(
            (stream, index) =>
              `${index + 1} 0 obj\n<< /Filter /FlateDecode >>\nstream\n${stream.toString('latin1')}\nendstream\nendobj\n`,
          )
          .join('') +
        '%%EOF',
      'latin1',
    );

  it('rejects a stream that inflates past the per-stream cap (a tiny file, hundreds of MB inflated)', async () => {
    const { deflateSync } = await import('node:zlib');
    const bomb = deflateSync(Buffer.alloc(300 * 1024 * 1024, 0x20)); // ~300 KB deflated
    expect(bomb.length).toBeLessThan(1024 * 1024);
    const extractor = new DefaultDocumentTextExtractor();
    const started = Date.now();
    await expect(extractor.extract('application/pdf', pdfWith([bomb]))).rejects.toThrow(
      /expands beyond the supported size/,
    );
    expect(Date.now() - started).toBeLessThan(2000); // bounded work, no multi-hundred-MB inflate
  });

  it('rejects many individually-allowed streams whose inflated total passes the overall cap', async () => {
    const { deflateSync } = await import('node:zlib');
    const stream = deflateSync(Buffer.alloc(1.5 * 1024 * 1024, 0x20)); // under the per-stream cap
    const extractor = new DefaultDocumentTextExtractor();
    await expect(
      extractor.extract('application/pdf', pdfWith(Array.from({ length: 8 }, () => stream))),
    ).rejects.toThrow(/expands beyond the supported size/);
  });

  it('still extracts a normal PDF', async () => {
    const { deflateSync } = await import('node:zlib');
    const stream = deflateSync(Buffer.from('BT (Quarterly plan) Tj ET', 'latin1'));
    const text = await new DefaultDocumentTextExtractor().extract(
      'application/pdf',
      pdfWith([stream]),
    );
    expect(text).toContain('Quarterly plan');
  });
});
