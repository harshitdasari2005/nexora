/**
 * @nexora/app-web — Knowledge Base page (S18).
 *
 * The Knowledge Base application view (FRONTEND.md §7 application
 * experience): lists the articles of the current workspace with loading,
 * empty, and error states; supports authoring (draft), publishing, editing,
 * and archiving; and shows a flat workspace-scoped category rail. Drafts are
 * visible to workspace members in the app UI, but ONLY published articles
 * are indexed and therefore reach the AI — publication is the freshness
 * gate (the same contract as the API and the AI retrieval path).
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Badge, Button, Card, EmptyState, Input, Stack, typography } from '@nexora/design-system';

import { AppShell } from '../components/AppShell.js';
import { ErrorState } from '../components/ErrorState.js';
import { LoadingScreen } from '../components/LoadingScreen.js';
import { api, ApiError } from '../lib/api.js';
import type { DashboardResponse, KnowledgeArticleDto, KnowledgeCategoryDto } from '../lib/types.js';
import { useSession } from '../session.js';

/** The knowledge base application page. */
export function Knowledge(): JSX.Element {
  const { data: session } = useSession();
  const [searchParams] = useSearchParams();

  const [state, setState] = useState<{
    dashboard: DashboardResponse | null;
    articles: KnowledgeArticleDto[];
    categories: KnowledgeCategoryDto[];
    loading: boolean;
    error: ApiError | null;
  }>({ dashboard: null, articles: [], categories: [], loading: true, error: null });

  const load = useCallback(async () => {
    setState({ dashboard: null, articles: [], categories: [], loading: true, error: null });
    try {
      const params = new URLSearchParams();
      const organizationId = searchParams.get('organizationId');
      const workspaceId = searchParams.get('workspaceId');
      if (organizationId !== null) params.set('organizationId', organizationId);
      if (workspaceId !== null) params.set('workspaceId', workspaceId);
      const suffix = params.size > 0 ? `?${params.toString()}` : '';
      const dashboard = await api<DashboardResponse>(`/dashboard${suffix}`);
      if (dashboard.organization === null || dashboard.workspace === null) {
        setState({ dashboard, articles: [], categories: [], loading: false, error: null });
        return;
      }
      const scope = `organizationId=${encodeURIComponent(dashboard.organization.id)}&workspaceId=${encodeURIComponent(dashboard.workspace.id)}`;
      const [listed, categoryList] = await Promise.all([
        api<{ articles: KnowledgeArticleDto[] }>(`/knowledge/articles?${scope}`),
        api<{ categories: KnowledgeCategoryDto[] }>(`/knowledge/categories?${scope}`),
      ]);
      setState({
        dashboard,
        articles: listed.articles,
        categories: categoryList.categories,
        loading: false,
        error: null,
      });
    } catch (error) {
      setState({
        dashboard: null,
        articles: [],
        categories: [],
        loading: false,
        error:
          error instanceof ApiError ? error : new ApiError(0, 'INTERNAL_ERROR', 'Request failed'),
      });
    }
  }, [searchParams]);

  useEffect(() => {
    void load();
  }, [load]);

  if (state.loading) {
    return <LoadingScreen />;
  }
  if (state.error !== null) {
    return <ErrorState message={state.error.message} onRetry={() => void load()} />;
  }
  const { dashboard } = state;
  if (dashboard === null || session === null) {
    return <LoadingScreen />;
  }
  if (dashboard.organization === null || dashboard.workspace === null) {
    return (
      <div
        style={{
          height: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: 24,
        }}
      >
        <Card padding={10} elevationLevel="md" style={{ maxWidth: 520, width: '100%' }}>
          <EmptyState
            icon="📚"
            title="Create a workspace first"
            description="The Knowledge Base lives inside a workspace. Set one up to get started."
            action={
              <Button size="lg" onClick={() => void load()}>
                Reload
              </Button>
            }
          />
        </Card>
      </div>
    );
  }

  return (
    <AppShell
      user={dashboard.user}
      organizationName={dashboard.organization.name}
      workspaceName={dashboard.workspace.name}
      organizationId={dashboard.organization.id}
      workspaceId={dashboard.workspace.id}
    >
      <KnowledgeView
        organizationId={dashboard.organization.id}
        workspaceId={dashboard.workspace.id}
        organizationName={dashboard.organization.name}
        initialArticles={state.articles}
        initialCategories={state.categories}
        onChanged={() => void load()}
      />
    </AppShell>
  );
}

/** Props of {@link KnowledgeView}. */
export interface KnowledgeViewProps {
  /** The current organization id (the trusted article scope). */
  organizationId: string;
  /** The current workspace id (the trusted article scope). */
  workspaceId: string;
  /** The current organization name. */
  organizationName: string;
  /** The articles to render. */
  initialArticles: readonly KnowledgeArticleDto[];
  /** The workspace categories (flat rail). */
  initialCategories: readonly KnowledgeCategoryDto[];
  /** Called after any lifecycle change (refresh the list). */
  onChanged: () => void;
}

/** The pure knowledge base content (exported for smoke tests). */
export function KnowledgeView({
  organizationId,
  workspaceId,
  organizationName,
  initialArticles,
  initialCategories,
  onChanged,
}: KnowledgeViewProps): JSX.Element {
  const [articles, setArticles] = useState<KnowledgeArticleDto[]>(() => [...initialArticles]);
  const [categories, setCategories] = useState<KnowledgeCategoryDto[]>(() => [
    ...initialCategories,
  ]);
  const [query, setQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);

  const visibleArticles = useMemo(() => {
    const term = query.trim().toLowerCase();
    return articles.filter((article) => {
      const matchesQuery =
        term.length === 0 ||
        article.title.toLowerCase().includes(term) ||
        article.body.toLowerCase().includes(term);
      const matchesCategory = selectedCategory === null || article.categoryId === selectedCategory;
      return matchesQuery && matchesCategory;
    });
  }, [articles, query, selectedCategory]);

  const handleCategoryCreated = useCallback(
    (category: KnowledgeCategoryDto) => {
      setCategories((current) => [category, ...current]);
      onChanged();
    },
    [onChanged],
  );

  const handleArticleChanged = useCallback(
    (article: KnowledgeArticleDto, action: 'created' | 'updated' | 'published' | 'archived') => {
      setArticles((current) => {
        if (action === 'created') {
          return [article, ...current];
        }
        return current.map((existing) => (existing.id === article.id ? article : existing));
      });
      onChanged();
    },
    [onChanged],
  );

  return (
    <Stack gap={8} style={{ maxWidth: 960, margin: '0 auto' }}>
      <Stack direction="row" gap={4} align="center" justify="space-between">
        <Stack gap={1}>
          <h1 style={{ fontSize: typography.sizes['2xl'], fontWeight: typography.weights.bold }}>
            Knowledge Base
          </h1>
          <p style={{ fontSize: typography.sizes.sm, color: 'var(--nexora-textSecondary)' }}>
            {organizationName}
          </p>
        </Stack>
        <Badge tone="primary" dot>
          {articles.length} {articles.length === 1 ? 'article' : 'articles'}
        </Badge>
      </Stack>

      {/* Search */}
      <Input
        id="knowledge-search"
        name="search"
        aria-label="Search articles"
        placeholder="Search articles…"
        value={query}
        onChange={(event) => setQuery(event.currentTarget.value)}
        style={{ maxWidth: 420 }}
      />

      <Stack direction="row" gap={6} align="flex-start">
        {/* Category rail */}
        <Stack gap={3} style={{ width: 200, flexShrink: 0 }}>
          <Stack
            direction="row"
            gap={3}
            align="center"
            justify="space-between"
            style={{ marginBottom: 4 }}
          >
            <h2 style={{ fontSize: typography.sizes.sm, fontWeight: typography.weights.semibold }}>
              Categories
            </h2>
            <CategoryCreator
              organizationId={organizationId}
              workspaceId={workspaceId}
              onCreated={handleCategoryCreated}
            />
          </Stack>
          <CategoryChip
            label="All"
            active={selectedCategory === null}
            onClick={() => setSelectedCategory(null)}
          />
          {categories.map((category) => (
            <CategoryChip
              key={category.id}
              label={category.name}
              active={selectedCategory === category.id}
              onClick={() => setSelectedCategory(category.id)}
            />
          ))}
        </Stack>

        {/* Article column */}
        <Stack gap={4} style={{ flex: 1, minWidth: 0 }}>
          <ArticleCreator
            organizationId={organizationId}
            workspaceId={workspaceId}
            categories={categories}
            onCreated={(article) => handleArticleChanged(article, 'created')}
          />

          {visibleArticles.length === 0 ? (
            <Card>
              <EmptyState
                icon="📚"
                title={
                  query.trim().length > 0 || selectedCategory !== null
                    ? 'No articles match'
                    : 'No articles yet'
                }
                description={
                  query.trim().length > 0 || selectedCategory !== null
                    ? 'Try a different search or clear the category filter.'
                    : 'Write the first article, then publish it — published articles answer the AI.'
                }
              />
            </Card>
          ) : (
            <Stack gap={3}>
              {visibleArticles.map((article) => (
                <ArticleRow
                  key={article.id}
                  article={article}
                  organizationId={organizationId}
                  workspaceId={workspaceId}
                  categories={categories}
                  onChanged={(changed) => handleArticleChanged(changed, 'updated')}
                  onPublished={(changed) => handleArticleChanged(changed, 'published')}
                  onArchived={(changed) => handleArticleChanged(changed, 'archived')}
                />
              ))}
            </Stack>
          )}
        </Stack>
      </Stack>
    </Stack>
  );
}

/** A category rail chip. */
function CategoryChip({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}): JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        border: '1px solid var(--nexora-border)',
        background: active ? 'var(--nexora-primarySoft)' : 'var(--nexora-surface)',
        color: active ? 'var(--nexora-primary)' : 'var(--nexora-textSecondary)',
        borderRadius: 999,
        padding: '6px 12px',
        fontSize: typography.sizes.sm,
        fontWeight: active ? typography.weights.medium : typography.weights.regular,
        cursor: 'pointer',
        textAlign: 'left',
      }}
    >
      {label}
    </button>
  );
}

/** Creates a flat workspace-scoped category. */
function CategoryCreator({
  organizationId,
  workspaceId,
  onCreated,
}: {
  organizationId: string;
  workspaceId: string;
  onCreated: (category: KnowledgeCategoryDto) => void;
}): JSX.Element {
  const [name, setName] = useState('');
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);

  const handleCreate = useCallback(async () => {
    const trimmed = name.trim();
    if (trimmed.length === 0) {
      return;
    }
    setCreating(true);
    setError(null);
    try {
      const created = await api<{ category: KnowledgeCategoryDto }>('/knowledge/categories', {
        method: 'POST',
        body: JSON.stringify({ organizationId, workspaceId, name: trimmed }),
      });
      setName('');
      onCreated(created.category);
    } catch (caught) {
      setError(
        caught instanceof ApiError
          ? caught
          : new ApiError(0, 'INTERNAL_ERROR', 'Category creation failed'),
      );
    } finally {
      setCreating(false);
    }
  }, [name, organizationId, workspaceId, onCreated]);

  return (
    <Stack direction="row" gap={2} align="center">
      <Input
        id="knowledge-category-name"
        name="categoryName"
        aria-label="New category name"
        placeholder="+ category"
        value={name}
        onChange={(event) => setName(event.currentTarget.value)}
        style={{ width: 130 }}
      />
      <Button size="sm" variant="ghost" onClick={() => void handleCreate()} disabled={creating}>
        {creating ? '…' : 'Add'}
      </Button>
      {error !== null ? (
        <span style={{ fontSize: typography.sizes.xs, color: 'var(--nexora-danger)' }}>
          {error.message}
        </span>
      ) : null}
    </Stack>
  );
}

/** The textarea styling shared by the article forms (design-system has no Textarea primitive). */
const TEXTAREA_STYLE: React.CSSProperties = {
  border: '1px solid var(--nexora-border)',
  borderRadius: 8,
  padding: '10px 12px',
  fontSize: 14,
  lineHeight: 1.5,
  background: 'var(--nexora-surface)',
  color: 'var(--nexora-text)',
  width: '100%',
  boxSizing: 'border-box',
  fontFamily: 'inherit',
};

/** The article authoring form (creates a DRAFT — never indexed). */
function ArticleCreator({
  organizationId,
  workspaceId,
  categories,
  onCreated,
}: {
  organizationId: string;
  workspaceId: string;
  categories: readonly KnowledgeCategoryDto[];
  onCreated: (article: KnowledgeArticleDto) => void;
}): JSX.Element {
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);

  const handleCreate = useCallback(async () => {
    setCreating(true);
    setError(null);
    try {
      const created = await api<{ article: KnowledgeArticleDto }>('/knowledge/articles', {
        method: 'POST',
        body: JSON.stringify({
          organizationId,
          workspaceId,
          title,
          body,
          categoryId: categoryId.length > 0 ? categoryId : undefined,
        }),
      });
      setTitle('');
      setBody('');
      setCategoryId('');
      onCreated(created.article);
    } catch (caught) {
      setError(
        caught instanceof ApiError
          ? caught
          : new ApiError(0, 'INTERNAL_ERROR', 'Article creation failed'),
      );
    } finally {
      setCreating(false);
    }
  }, [organizationId, workspaceId, title, body, categoryId, onCreated]);

  return (
    <Card>
      <Stack gap={3}>
        <div style={{ fontWeight: typography.weights.semibold }}>Write an article</div>
        <Input
          id="knowledge-article-title"
          name="articleTitle"
          aria-label="Article title"
          placeholder="Title"
          value={title}
          onChange={(event) => setTitle(event.currentTarget.value)}
        />
        <textarea
          id="knowledge-article-body"
          name="articleBody"
          aria-label="Article body"
          placeholder="Body — published articles answer the AI…"
          value={body}
          onChange={(event) => setBody(event.currentTarget.value)}
          rows={4}
          style={TEXTAREA_STYLE}
        />
        <Stack direction="row" gap={3} align="center" justify="space-between">
          <select
            id="knowledge-article-category"
            name="articleCategory"
            aria-label="Article category"
            value={categoryId}
            onChange={(event) => setCategoryId(event.currentTarget.value)}
            style={{
              border: '1px solid var(--nexora-border)',
              borderRadius: 8,
              padding: '8px 10px',
              fontSize: typography.sizes.sm,
              background: 'var(--nexora-surface)',
              color: 'var(--nexora-text)',
            }}
          >
            <option value="">No category</option>
            {categories.map((category) => (
              <option key={category.id} value={category.id}>
                {category.name}
              </option>
            ))}
          </select>
          <Button
            size="sm"
            onClick={() => void handleCreate()}
            disabled={creating || title.trim().length === 0 || body.trim().length === 0}
            loading={creating}
          >
            {creating ? 'Saving…' : 'Save draft'}
          </Button>
        </Stack>
        {error !== null ? (
          <div style={{ fontSize: typography.sizes.sm, color: 'var(--nexora-danger)' }}>
            {error.message}
          </div>
        ) : null}
      </Stack>
    </Card>
  );
}

/** A single article row with editor, publish, and archive actions. */
function ArticleRow({
  article,
  organizationId,
  workspaceId,
  categories,
  onChanged,
  onPublished,
  onArchived,
}: {
  article: KnowledgeArticleDto;
  organizationId: string;
  workspaceId: string;
  categories: readonly KnowledgeCategoryDto[];
  onChanged: (article: KnowledgeArticleDto) => void;
  onPublished: (article: KnowledgeArticleDto) => void;
  onArchived: (article: KnowledgeArticleDto) => void;
}): JSX.Element {
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(article.title);
  const [body, setBody] = useState(article.body);
  const [categoryId, setCategoryId] = useState(article.categoryId ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);

  const categoryName = useMemo(
    () => categories.find((category) => category.id === article.categoryId)?.name,
    [categories, article.categoryId],
  );

  const handleSave = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const updated = await api<{ article: KnowledgeArticleDto }>(
        `/knowledge/articles/${article.id}`,
        {
          method: 'PUT',
          body: JSON.stringify({
            organizationId,
            workspaceId,
            title,
            body,
            categoryId: categoryId.length > 0 ? categoryId : undefined,
          }),
        },
      );
      setEditing(false);
      onChanged(updated.article);
    } catch (caught) {
      setError(
        caught instanceof ApiError ? caught : new ApiError(0, 'INTERNAL_ERROR', 'Save failed'),
      );
    } finally {
      setBusy(false);
    }
  }, [article.id, organizationId, workspaceId, title, body, categoryId, onChanged]);

  const handlePublish = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const published = await api<{ article: KnowledgeArticleDto }>(
        `/knowledge/articles/${article.id}/publish`,
        {
          method: 'POST',
          body: JSON.stringify({ organizationId, workspaceId }),
        },
      );
      onPublished(published.article);
    } catch (caught) {
      setError(
        caught instanceof ApiError ? caught : new ApiError(0, 'INTERNAL_ERROR', 'Publish failed'),
      );
    } finally {
      setBusy(false);
    }
  }, [article.id, organizationId, workspaceId, onPublished]);

  const handleArchive = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const archived = await api<{ article: KnowledgeArticleDto }>(
        `/knowledge/articles/${article.id}/archive`,
        {
          method: 'POST',
          body: JSON.stringify({ organizationId, workspaceId }),
        },
      );
      onArchived(archived.article);
    } catch (caught) {
      setError(
        caught instanceof ApiError ? caught : new ApiError(0, 'INTERNAL_ERROR', 'Archive failed'),
      );
    } finally {
      setBusy(false);
    }
  }, [article.id, organizationId, workspaceId, onArchived]);

  return (
    <Card style={{ padding: '14px 16px' }}>
      <Stack gap={3}>
        <Stack direction="row" gap={4} align="center" justify="space-between">
          <Stack gap={0.5} style={{ minWidth: 0 }}>
            <div style={{ fontWeight: typography.weights.semibold }}>{article.title}</div>
            <Stack direction="row" gap={3} align="center">
              <ArticleStatusBadge status={article.status} />
              <span style={{ fontSize: typography.sizes.xs, color: 'var(--nexora-textMuted)' }}>
                v{article.contentVersion}
                {categoryName !== undefined ? ` · ${categoryName}` : ''}
              </span>
            </Stack>
            {error !== null ? (
              <div style={{ fontSize: typography.sizes.xs, color: 'var(--nexora-danger)' }}>
                {error.message}
              </div>
            ) : null}
          </Stack>
          <Stack direction="row" gap={3} align="center">
            {article.status !== 'archived' ? (
              <>
                {article.status === 'draft' ? (
                  <Button
                    size="sm"
                    onClick={() => void handlePublish()}
                    disabled={busy}
                    loading={busy}
                  >
                    Publish
                  </Button>
                ) : null}
                <Button size="sm" variant="ghost" onClick={() => setEditing((open) => !open)}>
                  {editing ? 'Cancel' : 'Edit'}
                </Button>
                <Button size="sm" variant="ghost" onClick={() => void handleArchive()}>
                  Archive
                </Button>
              </>
            ) : null}
          </Stack>
        </Stack>

        {!editing ? (
          <div
            style={{
              fontSize: typography.sizes.sm,
              color: 'var(--nexora-textSecondary)',
              whiteSpace: 'pre-wrap',
            }}
          >
            {article.body}
          </div>
        ) : (
          <Stack gap={3}>
            <Input
              id="knowledge-edit-title"
              name="articleTitle"
              aria-label={`Title for ${article.title}`}
              value={title}
              onChange={(event) => setTitle(event.currentTarget.value)}
            />
            <textarea
              id="knowledge-edit-body"
              name="articleBody"
              aria-label="Article body"
              value={body}
              onChange={(event) => setBody(event.currentTarget.value)}
              rows={5}
              style={TEXTAREA_STYLE}
            />
            <Stack direction="row" gap={3} align="center" justify="space-between">
              <select
                id="knowledge-edit-category"
                name="articleCategory"
                aria-label="Article category"
                value={categoryId}
                onChange={(event) => setCategoryId(event.currentTarget.value)}
                style={{
                  border: '1px solid var(--nexora-border)',
                  borderRadius: 8,
                  padding: '8px 10px',
                  fontSize: typography.sizes.sm,
                  background: 'var(--nexora-surface)',
                  color: 'var(--nexora-text)',
                }}
              >
                <option value="">No category</option>
                {categories.map((category) => (
                  <option key={category.id} value={category.id}>
                    {category.name}
                  </option>
                ))}
              </select>
              <Button size="sm" onClick={() => void handleSave()} disabled={busy} loading={busy}>
                {busy ? 'Saving…' : 'Save'}
              </Button>
            </Stack>
          </Stack>
        )}
      </Stack>
    </Card>
  );
}

/** Maps an article lifecycle status to a readable badge. */
export function ArticleStatusBadge({ status }: { status: string }): JSX.Element {
  if (status === 'draft') {
    return <Badge>Draft</Badge>;
  }
  if (status === 'published') {
    return (
      <Badge tone="success" dot>
        Published
      </Badge>
    );
  }
  if (status === 'archived') {
    return <Badge>Archived</Badge>;
  }
  return <Badge>Unknown</Badge>;
}
