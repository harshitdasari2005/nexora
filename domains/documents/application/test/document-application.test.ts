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
    storage?: DocumentStorage;
    extractor?: DocumentTextExtractor;
    publisher?: EventPublisher & { published: readonly EventEnvelope[] };
  } = {},
) {
  const documents = options.documents ?? new InMemoryDocumentRepository();
  const storage = options.storage ?? new InMemoryDocumentStorage();
  const extractor = options.extractor ?? new DefaultDocumentTextExtractor();
  const publisher = options.publisher ?? recordingPublisher();
  const service = new DocumentApplicationService({
    documentsService: new DocumentDomainService({ documents }),
    documents,
    storage,
    extractor,
    publisher,
  });
  return { service, documents, storage, extractor, publisher };
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
