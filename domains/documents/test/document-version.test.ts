/**
 * DocumentVersion + restore-semantics tests (S17 version history):
 *
 * - Version numbers are monotonic and validated (positive integers).
 * - Historical versions are immutable (no mutation methods; hydrate/snapshot
 *   round-trips preserve history untouched).
 * - Restoring creates a NEW current version on the Document aggregate; the
 *   historical version records are never mutated.
 * - Only `available` documents accept new content; archived documents reject
 *   every content adoption.
 */

import { describe, expect, it } from 'vitest';
import type { TenantId, UserId, WorkspaceId } from '@nexora/contracts/common';

import {
  ContentRef,
  Document,
  DocumentStateTransitionError,
  DocumentStatus,
  DocumentVersion,
  DocumentVersionId,
  InvalidDocumentValueError,
  validateVersion,
  type DocumentEventContext,
} from '../src/index.js';

const TENANT = 'org_acme' as TenantId;
const WORKSPACE = 'wsp_engineering' as WorkspaceId;
const UPLOADER = 'usr_alice' as UserId;

function context(): DocumentEventContext {
  return {
    actor: { kind: 'user', id: UPLOADER },
    correlationId: 'corr_1',
    organizationId: TENANT,
  };
}

/** An `available` document (uploaded → processing → available). */
function availableDocument(): Document {
  const document = Document.create(
    {
      organizationId: TENANT,
      workspaceId: WORKSPACE,
      uploaderId: UPLOADER,
      title: 'Mobile Banking Project Plan',
      contentType: 'text/plain',
    },
    ContentRef.forDocument('doc_test', 1),
    context(),
    '2026-08-10T00:00:00.000Z',
  );
  document.markProcessing(context(), '2026-08-10T00:00:01.000Z');
  document.completeProcessing(context(), '2026-08-10T00:00:02.000Z');
  return document;
}

function versionInput(overrides: Partial<Parameters<typeof DocumentVersion.create>[0]> = {}) {
  return {
    documentId: 'doc_test' as never,
    organizationId: TENANT,
    workspaceId: WORKSPACE,
    version: 2,
    contentRef: 'doc/doc_test/v2',
    contentType: 'text/plain',
    createdBy: UPLOADER,
    ...overrides,
  };
}

describe('DocumentVersion aggregate (immutable history)', () => {
  it('creates an immutable revision record with a prefixed id', () => {
    const version = DocumentVersion.create(versionInput());
    expect(version.id).toMatch(/^docver_/);
    expect(version.documentId).toBe('doc_test');
    expect(version.organizationId).toBe(TENANT);
    expect(version.workspaceId).toBe(WORKSPACE);
    expect(version.version).toBe(2);
    expect(version.contentRef.value).toBe('doc/doc_test/v2');
    expect(version.createdBy).toBe(UPLOADER);
    expect(version.restoredFromVersion).toBeUndefined();
    // Immutable by construction: no mutation methods exist on the class.
    expect(Object.getOwnPropertyNames(Object.getPrototypeOf(version))).not.toContain('archive');
  });

  it('records the restored-from version when a revision is a restore', () => {
    const version = DocumentVersion.create(versionInput({ restoredFromVersion: 1 }));
    expect(version.restoredFromVersion).toBe(1);
  });

  it('rejects non-positive and non-integer versions', () => {
    expect(() => DocumentVersion.create(versionInput({ version: 0 }))).toThrow(
      InvalidDocumentValueError,
    );
    expect(() => DocumentVersion.create(versionInput({ version: -1 }))).toThrow(
      InvalidDocumentValueError,
    );
    expect(() => DocumentVersion.create(versionInput({ version: 1.5 }))).toThrow(
      InvalidDocumentValueError,
    );
    expect(validateVersion(3)).toBe(3);
  });

  it('round-trips through snapshot and hydrate preserving history untouched', () => {
    const version = DocumentVersion.create(versionInput({ restoredFromVersion: 1 }));
    const restored = DocumentVersion.hydrate(DocumentVersion.snapshot(version));
    expect(restored.id).toBe(version.id);
    expect(restored.version).toBe(2);
    expect(restored.contentRef.value).toBe('doc/doc_test/v2');
    expect(restored.restoredFromVersion).toBe(1);
    expect(restored.createdAt).toBe(version.createdAt);
  });

  it('validates the record id factory', () => {
    expect(DocumentVersionId.create()).toMatch(/^docver_/);
    expect(() => DocumentVersionId.from('')).toThrow(InvalidDocumentValueError);
  });
});

describe('Document content adoption (new version + restore)', () => {
  it('uploadNewContent replaces the current content and bumps the version', () => {
    const document = availableDocument();
    document.pullDomainEvents();

    document.uploadNewContent(ContentRef.forDocument(document.id, 2), 2, context());
    expect(document.contentRef.value).toBe(`doc/${document.id}/v2`);
    expect(document.contentVersion).toBe(3);
    expect(document.status.value).toBe('available');
    const events = document.pullDomainEvents();
    expect(events.map((event) => event.type)).toEqual(['document.version_uploaded']);
    // The event carries the adopted REVISION (2) — never the legacy counter.
    expect(events[0]?.payload).toMatchObject({ version: 2 });
  });

  it('restoreContent creates a NEW current version and never mutates history', () => {
    const document = availableDocument();
    document.pullDomainEvents();

    document.restoreContent(ContentRef.forDocument(document.id, 3), 1, 3, context());
    expect(document.contentRef.value).toBe(`doc/${document.id}/v3`);
    expect(document.contentVersion).toBe(3);
    const events = document.pullDomainEvents();
    expect(events.map((event) => event.type)).toEqual(['document.version_restored']);
    // The event carries the adopted REVISION (3) — never the legacy counter.
    expect(events[0]?.payload).toMatchObject({ version: 3, restoredFromVersion: 1 });

    // The historical version record (v1 content at doc/.../v1) is untouched:
    // a restore never rewrites history — it copies content forward.
    const v1 = DocumentVersion.create(
      versionInput({
        documentId: document.id as never,
        version: 1,
        contentRef: `doc/${document.id}/v1`,
      }),
    );
    const restoredV1 = DocumentVersion.hydrate(DocumentVersion.snapshot(v1));
    expect(restoredV1.contentRef.value).toBe(`doc/${document.id}/v1`);
    expect(restoredV1.version).toBe(1);
  });

  it('rejects content adoption on a non-available document (validate → mutate)', () => {
    const document = Document.create(
      {
        organizationId: TENANT,
        workspaceId: WORKSPACE,
        uploaderId: UPLOADER,
        title: 'Fresh',
        contentType: 'text/plain',
      },
      ContentRef.forDocument('doc_fresh', 1),
      context(),
    );
    document.pullDomainEvents();

    expect(() =>
      document.uploadNewContent(ContentRef.forDocument(document.id, 2), 2, context()),
    ).toThrow(DocumentStateTransitionError);
    expect(document.status.value).toBe('uploaded');
    expect(document.pullDomainEvents()).toEqual([]);
  });

  it('rejects content adoption on an archived document', () => {
    const document = availableDocument();
    document.pullDomainEvents();
    document.archive(context());
    document.pullDomainEvents();

    expect(() =>
      document.uploadNewContent(ContentRef.forDocument(document.id, 2), 2, context()),
    ).toThrow(DocumentStateTransitionError);
    expect(() =>
      document.restoreContent(ContentRef.forDocument(document.id, 3), 1, 3, context()),
    ).toThrow(DocumentStateTransitionError);
    expect(document.status.value).toBe(DocumentStatus.archived().value);
  });
});
