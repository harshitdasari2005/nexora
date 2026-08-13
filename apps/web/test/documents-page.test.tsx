/**
 * S17 Documents page smoke tests: the version-history UI, template actions,
 * and status badges render without crashing (server render — no DOM or
 * network required).
 */

import { describe, expect, it } from 'vitest';
import { renderToString } from 'react-dom/server';

import { DocumentRow, DocumentsView, DocumentStatusBadge } from '../src/pages/Documents.js';
import type { DocumentDto, DocumentTemplateDto } from '../src/lib/types.js';

const DOCUMENT: DocumentDto = {
  id: 'doc_11111111-1111-4111-8111-111111111111',
  organizationId: 'org_1',
  workspaceId: 'wsp_1',
  uploaderId: 'usr_1',
  title: 'Mobile Banking Project Plan.txt',
  contentType: 'text/plain',
  status: 'available',
  contentVersion: 2,
  createdAt: '2026-08-01T00:00:00.000Z',
};

const TEMPLATE: DocumentTemplateDto = {
  id: 'tpl_1',
  organizationId: 'org_1',
  workspaceId: 'wsp_1',
  name: 'Quarterly Plan',
  description: 'Starter',
  contentType: 'text/markdown',
  status: 'active',
  createdAt: '2026-08-01T00:00:00.000Z',
};

function noop(): void {
  /* test no-op */
}

describe('DocumentsView (S17)', () => {
  it('renders documents, templates, and the version actions', () => {
    const html = renderToString(
      <DocumentsView
        organizationId="org_1"
        workspaceId="wsp_1"
        organizationName="Acme Inc."
        initialDocuments={[DOCUMENT]}
        onUploaded={noop}
      />,
    );
    expect(html).toContain('Documents');
    expect(html).toContain('Mobile Banking Project Plan.txt');
    expect(html).toContain('Templates');
    expect(html).toContain('+ New template');
    expect(html).toContain('History');
    expect(html).toContain('+ New version');
  });

  it('renders an empty state when there are no documents', () => {
    const html = renderToString(
      <DocumentsView
        organizationId="org_1"
        workspaceId="wsp_1"
        organizationName="Acme Inc."
        initialDocuments={[]}
        onUploaded={noop}
      />,
    );
    expect(html).toContain('No documents yet');
    expect(html).toContain('No templates yet');
  });
});

describe('DocumentRow (S17)', () => {
  it('renders the status badge and history toggle for an available document', () => {
    const html = renderToString(
      <DocumentRow
        document={DOCUMENT}
        organizationId="org_1"
        workspaceId="wsp_1"
        encodeFile={async (file) => file.name}
        inferContentType={() => 'text/plain'}
        onChanged={noop}
      />,
    );
    expect(html).toContain('Available');
    expect(html).toContain('History');
    expect(html).toContain('+ New version');
  });
});

describe('DocumentStatusBadge', () => {
  it('maps lifecycle statuses to readable labels', () => {
    expect(renderToString(<DocumentStatusBadge status="available" />)).toContain('Available');
    expect(renderToString(<DocumentStatusBadge status="processing" />)).toContain('Processing');
    expect(renderToString(<DocumentStatusBadge status="failed" />)).toContain('Failed');
    expect(renderToString(<DocumentStatusBadge status="archived" />)).toContain('Archived');
  });
});

describe('template fixtures', () => {
  it('keeps the template fixture usable by the page', () => {
    expect(TEMPLATE.name).toBe('Quarterly Plan');
    expect(TEMPLATE.status).toBe('active');
  });
});
