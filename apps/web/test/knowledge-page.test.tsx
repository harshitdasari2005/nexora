/**
 * S18 Knowledge Base page smoke tests: the article list, status badges,
 * category rail, and article row render without crashing (server render —
 * no DOM or network required).
 */

import { describe, expect, it } from 'vitest';
import { renderToString } from 'react-dom/server';

import { ArticleStatusBadge, KnowledgeView } from '../src/pages/Knowledge.js';
import type { KnowledgeArticleDto, KnowledgeCategoryDto } from '../src/lib/types.js';

const DRAFT: KnowledgeArticleDto = {
  id: 'art_11111111-1111-4111-8111-111111111111',
  tenantId: 'org_1',
  workspaceId: 'wsp_1',
  title: 'Leave Policy Draft',
  body: 'Employees get 25 annual leave days.',
  status: 'draft',
  contentVersion: 1,
  author: 'usr_1',
  createdAt: '2026-08-01T00:00:00.000Z',
  updatedAt: '2026-08-01T00:00:00.000Z',
};

const PUBLISHED: KnowledgeArticleDto = {
  id: 'art_22222222-2222-4222-8222-222222222222',
  tenantId: 'org_1',
  workspaceId: 'wsp_1',
  title: 'Leave Policy',
  body: 'Employees may bank up to 5 unused leave days.',
  categoryId: 'kcat_33333333-3333-4333-8333-333333333333',
  status: 'published',
  contentVersion: 2,
  author: 'usr_1',
  createdAt: '2026-08-01T00:00:00.000Z',
  updatedAt: '2026-08-02T00:00:00.000Z',
};

const CATEGORY: KnowledgeCategoryDto = {
  id: 'kcat_33333333-3333-4333-8333-333333333333',
  tenantId: 'org_1',
  workspaceId: 'wsp_1',
  name: 'Policies',
  archived: false,
  createdAt: '2026-08-01T00:00:00.000Z',
};

function noop(): void {
  /* test no-op */
}

describe('KnowledgeView (S18)', () => {
  it('renders articles, categories, and the authoring form', () => {
    const html = renderToString(
      <KnowledgeView
        organizationId="org_1"
        workspaceId="wsp_1"
        organizationName="Acme Inc."
        initialArticles={[DRAFT, PUBLISHED]}
        initialCategories={[CATEGORY]}
        onChanged={noop}
      />,
    );
    expect(html).toContain('Knowledge Base');
    expect(html).toContain('Leave Policy');
    expect(html).toContain('Write an article');
    expect(html).toContain('Policies');
    expect(html).toContain('Publish');
    expect(html).toContain('Archive');
    expect(html).toContain('Search articles');
  });

  it('renders an empty state when there are no articles', () => {
    const html = renderToString(
      <KnowledgeView
        organizationId="org_1"
        workspaceId="wsp_1"
        organizationName="Acme Inc."
        initialArticles={[]}
        initialCategories={[]}
        onChanged={noop}
      />,
    );
    expect(html).toContain('No articles yet');
  });
});

describe('ArticleStatusBadge (S18)', () => {
  it('maps lifecycle statuses to readable labels', () => {
    expect(renderToString(<ArticleStatusBadge status="draft" />)).toContain('Draft');
    expect(renderToString(<ArticleStatusBadge status="published" />)).toContain('Published');
    expect(renderToString(<ArticleStatusBadge status="archived" />)).toContain('Archived');
  });
});
