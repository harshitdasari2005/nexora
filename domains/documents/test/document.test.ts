/**
 * Document aggregate tests: creation, the processing lifecycle
 * (uploaded → processing → available / failed → processing → archived),
 * invalid transitions, validate-before-mutate, events, and hydrate.
 */

import { describe, expect, it } from 'vitest';
import type { TenantId, UserId, WorkspaceId } from '@nexora/contracts/common';

import {
  ContentRef,
  Document,
  DocumentStateTransitionError,
  DocumentStatus,
  InvalidDocumentValueError,
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

function create(now = '2026-08-10T00:00:00.000Z'): Document {
  return Document.create(
    {
      organizationId: TENANT,
      workspaceId: WORKSPACE,
      uploaderId: UPLOADER,
      title: 'Mobile Banking Project Plan',
      contentType: 'text/plain',
    },
    ContentRef.forDocument('doc_test', 1),
    context(),
    now,
  );
}

describe('Document creation', () => {
  it('creates an uploaded document with immutable scope and a content ref', () => {
    const document = create();
    expect(document.status.value).toBe('uploaded');
    expect(document.organizationId).toBe(TENANT);
    expect(document.workspaceId).toBe(WORKSPACE);
    expect(document.uploaderId).toBe(UPLOADER);
    expect(document.title.value).toBe('Mobile Banking Project Plan');
    expect(document.contentRef.value).toBe('doc/doc_test/v1');
    expect(document.contentVersion).toBe(1);
    expect(document.version).toBe(1);
    expect(document.isAvailable()).toBe(false);
  });

  it('emits document.uploaded on create', () => {
    const document = create();
    const events = document.pullDomainEvents();
    expect(events.map((event) => event.type)).toEqual(['document.uploaded']);
    expect(events[0]?.payload).toMatchObject({
      documentId: document.id,
      title: 'Mobile Banking Project Plan',
      workspaceId: WORKSPACE,
      uploaderId: UPLOADER,
      status: 'uploaded',
    });
  });

  it('rejects an empty title (no aggregate is created)', () => {
    expect(() =>
      Document.create(
        {
          organizationId: TENANT,
          workspaceId: WORKSPACE,
          uploaderId: UPLOADER,
          title: '   ',
          contentType: 'text/plain',
        },
        ContentRef.forDocument('doc_x', 1),
        context(),
      ),
    ).toThrow(InvalidDocumentValueError);
  });
});

describe('Document processing lifecycle', () => {
  it('walks uploaded → processing → available, bumping the content version', () => {
    const document = create();
    document.pullDomainEvents();

    document.markProcessing(context());
    expect(document.status.value).toBe('processing');
    expect(document.pullDomainEvents().map((event) => event.type)).toEqual([
      'document.processing_started',
    ]);

    document.completeProcessing(context());
    expect(document.status.value).toBe('available');
    expect(document.isAvailable()).toBe(true);
    expect(document.contentVersion).toBe(2);
    const events = document.pullDomainEvents();
    expect(events.map((event) => event.type)).toEqual(['document.available']);
    expect(events[0]?.payload).toMatchObject({ version: 2 });
  });

  it('fails processing with a safe reason (retryable, never searchable)', () => {
    const document = create();
    document.pullDomainEvents();
    document.markProcessing(context());
    document.pullDomainEvents();

    document.failProcessing('PDF extraction is not available in this deployment', context());
    expect(document.status.value).toBe('failed');
    expect(document.failureReason).toContain('PDF extraction');
    expect(document.isAvailable()).toBe(false);
    expect(document.pullDomainEvents().map((event) => event.type)).toEqual([
      'document.processing_failed',
    ]);

    // Retry: failed → processing → available works.
    document.markProcessing(context());
    document.completeProcessing(context());
    expect(document.status.value).toBe('available');
    expect(document.failureReason).toBeUndefined();
  });

  it('archives an available document (terminal — leaves the index)', () => {
    const document = create();
    document.pullDomainEvents();
    document.markProcessing(context());
    document.completeProcessing(context());
    document.pullDomainEvents();

    document.archive(context());
    expect(document.status.value).toBe('archived');
    expect(document.isAvailable()).toBe(false);
    expect(document.pullDomainEvents().map((event) => event.type)).toEqual(['document.archived']);
  });

  it('rejects invalid transitions and does NOT mutate (validate → mutate)', () => {
    const document = create();
    document.pullDomainEvents();
    // uploaded → available is not allowed (processing is required).
    expect(() => document.completeProcessing(context())).toThrow(DocumentStateTransitionError);
    expect(document.status.value).toBe('uploaded');
    expect(document.pullDomainEvents()).toEqual([]);

    // available → processing is not allowed.
    document.markProcessing(context());
    document.completeProcessing(context());
    document.pullDomainEvents();
    expect(() => document.markProcessing(context())).toThrow(DocumentStateTransitionError);
    expect(document.status.value).toBe('available');
  });

  it('rejects every mutation once archived', () => {
    const document = create();
    document.pullDomainEvents();
    document.markProcessing(context());
    document.completeProcessing(context());
    document.archive(context());
    document.pullDomainEvents();

    expect(() => document.markProcessing(context())).toThrow(DocumentStateTransitionError);
    expect(() => document.completeProcessing(context())).toThrow(DocumentStateTransitionError);
    expect(() => document.archive(context())).toThrow(DocumentStateTransitionError);
    expect(document.status.value).toBe('archived');
  });

  it('cannot archive a failed document', () => {
    const document = create();
    document.pullDomainEvents();
    document.markProcessing(context());
    document.failProcessing('boom', context());
    expect(() => document.archive(context())).toThrow(DocumentStateTransitionError);
  });
});

describe('Document hydrate', () => {
  it('round-trips through snapshot and hydrate without events', () => {
    const document = create();
    document.pullDomainEvents();
    document.markProcessing(context());
    document.completeProcessing(context());
    document.pullDomainEvents();

    const restored = Document.hydrate(Document.snapshot(document));
    expect(restored.id).toBe(document.id);
    expect(restored.status.value).toBe('available');
    expect(restored.contentVersion).toBe(2);
    expect(restored.workspaceId).toBe(WORKSPACE);
    expect(restored.version).toBe(document.version);
    expect(restored.pullDomainEvents()).toEqual([]);
  });

  it('hydrates a failed document with its failure reason', () => {
    const document = create();
    document.pullDomainEvents();
    document.markProcessing(context());
    document.failProcessing('extraction error', context());
    const restored = Document.hydrate(Document.snapshot(document));
    expect(restored.status.value).toBe('failed');
    expect(restored.failureReason).toBe('extraction error');
  });
});

describe('DocumentStatus', () => {
  it('reconstructs known statuses and rejects unknown ones', () => {
    expect(DocumentStatus.from('available').value).toBe('available');
    expect(() => DocumentStatus.from('nope')).toThrow();
  });
});
