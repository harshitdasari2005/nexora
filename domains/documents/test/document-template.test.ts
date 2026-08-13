/**
 * DocumentTemplate aggregate tests (S17 templates):
 *
 * - Creation records `document.template_created` with the trusted scope.
 * - Lifecycle is `active → archived` (terminal); archived templates reject
 *   re-archival and are never active.
 * - Snapshot/hydrate round-trips preserve status and scope.
 */

import { describe, expect, it } from 'vitest';
import type { TenantId, UserId, WorkspaceId } from '@nexora/contracts/common';

import {
  DocumentStateTransitionError,
  DocumentTemplate,
  DocumentTemplateId,
  InvalidDocumentValueError,
  type DocumentEventContext,
} from '../src/index.js';

const TENANT = 'org_acme' as TenantId;
const WORKSPACE = 'wsp_engineering' as WorkspaceId;
const CREATOR = 'usr_alice' as UserId;

function context(): DocumentEventContext {
  return {
    actor: { kind: 'user', id: CREATOR },
    correlationId: 'corr_1',
    organizationId: TENANT,
  };
}

function templateInput(overrides: Partial<Parameters<typeof DocumentTemplate.create>[0]> = {}) {
  return {
    organizationId: TENANT,
    workspaceId: WORKSPACE,
    createdBy: CREATOR,
    name: 'Quarterly Plan',
    description: 'Starter for quarterly planning documents',
    contentType: 'text/markdown',
    contentRef: 'tpl/quarterly/v1',
    ...overrides,
  };
}

describe('DocumentTemplate aggregate', () => {
  it('creates an active template with immutable scope and emits template_created', () => {
    const template = DocumentTemplate.create(templateInput(), context());
    expect(template.id).toMatch(/^tpl_/);
    expect(template.organizationId).toBe(TENANT);
    expect(template.workspaceId).toBe(WORKSPACE);
    expect(template.name).toBe('Quarterly Plan');
    expect(template.description).toBe('Starter for quarterly planning documents');
    expect(template.contentType).toBe('text/markdown');
    expect(template.contentRef.value).toBe('tpl/quarterly/v1');
    expect(template.isActive()).toBe(true);
    expect(template.version).toBe(1);

    const events = template.pullDomainEvents();
    expect(events.map((event) => event.type)).toEqual(['document.template_created']);
    expect(events[0]?.payload).toMatchObject({
      templateId: template.id,
      organizationId: TENANT,
      workspaceId: WORKSPACE,
      name: 'Quarterly Plan',
      status: 'active',
    });
  });

  it('archives an active template (terminal) and emits template_archived', () => {
    const template = DocumentTemplate.create(templateInput(), context());
    template.pullDomainEvents();

    template.archive(context());
    expect(template.isActive()).toBe(false);
    expect(template.status.value).toBe('archived');
    expect(template.version).toBe(2);
    expect(template.pullDomainEvents().map((event) => event.type)).toEqual([
      'document.template_archived',
    ]);

    // Archived is terminal: re-archival is rejected (validate → mutate).
    expect(() => template.archive(context())).toThrow(DocumentStateTransitionError);
    expect(template.status.value).toBe('archived');
  });

  it('rejects an empty template name (no aggregate is created)', () => {
    expect(() => DocumentTemplate.create(templateInput({ name: '   ' }), context())).toThrow(
      InvalidDocumentValueError,
    );
  });

  it('normalizes an empty description to undefined', () => {
    const template = DocumentTemplate.create(templateInput({ description: '   ' }), context());
    expect(template.description).toBeUndefined();
  });

  it('round-trips through snapshot and hydrate preserving status and scope', () => {
    const template = DocumentTemplate.create(templateInput(), context());
    template.pullDomainEvents();
    template.archive(context());
    template.pullDomainEvents();

    const restored = DocumentTemplate.hydrate(DocumentTemplate.snapshot(template));
    expect(restored.id).toBe(template.id);
    expect(restored.organizationId).toBe(TENANT);
    expect(restored.workspaceId).toBe(WORKSPACE);
    expect(restored.status.value).toBe('archived');
    expect(restored.isActive()).toBe(false);
    expect(restored.version).toBe(template.version);
    expect(restored.pullDomainEvents()).toEqual([]);
  });

  it('validates the template id factory', () => {
    expect(DocumentTemplateId.create()).toMatch(/^tpl_/);
    expect(() => DocumentTemplateId.from('')).toThrow(InvalidDocumentValueError);
  });
});
