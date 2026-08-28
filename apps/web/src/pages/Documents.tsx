/**
 * @nexora/app-web — Documents page.
 *
 * The Documents + Knowledge application view (FRONTEND.md §7 application
 * experience): lists the documents of the current workspace with loading,
 * empty, and error states, supports uploading a document, AND (S17) provides
 * the version lifecycle — version history, new-version upload, restore, and
 * workspace templates (create / use / archive).
 *
 * Uploads flow through the same application boundary the AI knowledge
 * capability uses (`POST /api/documents`): store bytes → persist metadata →
 * processing → knowledge index. The page shows the honest processing state —
 * a document is only listed as `available` when its content is actually
 * searchable. Restoring a version creates a NEW revision (never mutating
 * history) and refreshes retrieval.
 */

import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  Input,
  Skeleton,
  Stack,
  typography,
} from '@nexora/design-system';

import { AppShell } from '../components/AppShell.js';
import { ErrorState } from '../components/ErrorState.js';
import { LoadingScreen } from '../components/LoadingScreen.js';
import { api, ApiError } from '../lib/api.js';
import type {
  DashboardResponse,
  DocumentDto,
  DocumentTemplateDto,
  DocumentVersionDto,
} from '../lib/types.js';
import { useSession } from '../session.js';

/** The documents application page. */
export function Documents(): JSX.Element {
  const { data: session } = useSession();
  const [searchParams] = useSearchParams();

  const [state, setState] = useState<{
    dashboard: DashboardResponse | null;
    documents: DocumentDto[];
    loading: boolean;
    error: ApiError | null;
  }>({ dashboard: null, documents: [], loading: true, error: null });

  const load = useCallback(async () => {
    // Keeps any already-loaded dashboard visible while refetching — a role
    // switch re-runs this exact effect, and resetting to `null` would
    // unmount AppShell (sidebar included) on every switch.
    setState((current) => ({ ...current, loading: true, error: null }));
    try {
      const params = new URLSearchParams();
      const organizationId = searchParams.get('organizationId');
      const workspaceId = searchParams.get('workspaceId');
      if (organizationId !== null) params.set('organizationId', organizationId);
      if (workspaceId !== null) params.set('workspaceId', workspaceId);
      const suffix = params.size > 0 ? `?${params.toString()}` : '';
      const dashboard = await api<DashboardResponse>(`/dashboard${suffix}`);
      if (dashboard.organization === null || dashboard.workspace === null) {
        setState({ dashboard, documents: [], loading: false, error: null });
        return;
      }
      const listed = await api<{ documents: DocumentDto[] }>(
        `/documents?organizationId=${encodeURIComponent(dashboard.organization.id)}&workspaceId=${encodeURIComponent(dashboard.workspace.id)}`,
      );
      setState({ dashboard, documents: listed.documents, loading: false, error: null });
    } catch (error) {
      setState((current) => ({
        ...current,
        loading: false,
        error:
          error instanceof ApiError ? error : new ApiError(0, 'INTERNAL_ERROR', 'Request failed'),
      }));
    }
  }, [searchParams]);

  useEffect(() => {
    void load();
  }, [load]);

  if (state.loading && state.dashboard === null) {
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
            icon="🗂"
            title="Create a workspace first"
            description="Documents live inside a workspace. Set one up to get started."
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
      <DocumentsView
        organizationId={dashboard.organization.id}
        workspaceId={dashboard.workspace.id}
        organizationName={dashboard.organization.name}
        initialDocuments={state.documents}
        onUploaded={() => void load()}
      />
    </AppShell>
  );
}

/** Props of {@link DocumentsView}. */
export interface DocumentsViewProps {
  /** The current organization id (the trusted upload scope). */
  organizationId: string;
  /** The current workspace id (the trusted upload scope). */
  workspaceId: string;
  /** The current organization name. */
  organizationName: string;
  /** The documents to render. */
  initialDocuments: readonly DocumentDto[];
  /** Called after a successful upload (refresh the list). */
  onUploaded: () => void;
}

/** The pure documents content (exported for smoke tests). */
export function DocumentsView({
  organizationId,
  workspaceId,
  organizationName,
  initialDocuments,
  onUploaded,
}: DocumentsViewProps): JSX.Element {
  const [documents, setDocuments] = useState<DocumentDto[]>(() => [...initialDocuments]);
  const [templates, setTemplates] = useState<DocumentTemplateDto[]>([]);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<ApiError | null>(null);

  const loadTemplates = useCallback(async () => {
    try {
      const listed = await api<{ templates: DocumentTemplateDto[] }>(
        `/documents/templates?organizationId=${encodeURIComponent(organizationId)}&workspaceId=${encodeURIComponent(workspaceId)}`,
      );
      setTemplates(listed.templates);
    } catch {
      setTemplates([]);
    }
  }, [organizationId, workspaceId]);

  useEffect(() => {
    void loadTemplates();
  }, [loadTemplates]);

  /** Base64-encodes a File's bytes (the API contract carries content as base64). */
  const encodeFile = useCallback(async (file: File): Promise<string> => {
    const bytes = new Uint8Array(await file.arrayBuffer());
    let binary = '';
    for (const byte of bytes) {
      binary += String.fromCharCode(byte);
    }
    return btoa(binary);
  }, []);

  /** Infers a content type from the file (matches the API's supported set). */
  const inferContentType = useCallback((file: File): string => {
    if (file.type.length > 0) return file.type;
    return file.name.endsWith('.pdf') ? 'application/pdf' : 'text/plain';
  }, []);

  const handleUpload = useCallback(
    async (file: File) => {
      setUploading(true);
      setUploadError(null);
      try {
        const created = await api<{ document: DocumentDto; indexed: boolean }>('/documents', {
          method: 'POST',
          body: JSON.stringify({
            organizationId,
            workspaceId,
            title: file.name,
            contentType: inferContentType(file),
            content: await encodeFile(file),
          }),
        });
        setDocuments((current) => [created.document, ...current]);
        onUploaded();
      } catch (error) {
        setUploadError(
          error instanceof ApiError ? error : new ApiError(0, 'INTERNAL_ERROR', 'Upload failed'),
        );
      } finally {
        setUploading(false);
      }
    },
    [organizationId, workspaceId, onUploaded, encodeFile, inferContentType],
  );

  return (
    <Stack gap={8} style={{ maxWidth: 880, margin: '0 auto' }}>
      <Stack direction="row" gap={4} align="center" justify="space-between">
        <Stack gap={1}>
          <h1 style={{ fontSize: typography.sizes['3xl'], fontWeight: typography.weights.bold, letterSpacing: '-0.03em', lineHeight: 1.1 }}>
            Documents
          </h1>
          <p style={{ fontSize: typography.sizes.sm, color: 'var(--nexora-textSecondary)' }}>
            {organizationName}
          </p>
        </Stack>
        <Badge tone="primary" dot>
          {documents.length} {documents.length === 1 ? 'document' : 'documents'}
        </Badge>
      </Stack>

      {/* Upload */}
      <Card>
        <Stack gap={3}>
          <Stack direction="row" gap={3} align="center" justify="space-between">
            <Stack gap={0.5}>
              <div style={{ fontWeight: typography.weights.semibold }}>Upload a document</div>
              <div style={{ fontSize: typography.sizes.xs, color: 'var(--nexora-textMuted)' }}>
                Plain text, Markdown, or PDF. After processing, ask the AI about it.
              </div>
            </Stack>
            <label
              style={{
                display: 'inline-flex',
                cursor: uploading ? 'default' : 'pointer',
                opacity: uploading ? 0.6 : 1,
              }}
            >
              <Button size="sm" disabled={uploading}>
                {uploading ? 'Uploading…' : 'Choose file'}
              </Button>
              <input
                type="file"
                accept=".txt,.md,.markdown,.json,text/plain,text/markdown,application/pdf"
                style={{ display: 'none' }}
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file !== undefined) void handleUpload(file);
                  event.currentTarget.value = '';
                }}
              />
            </label>
          </Stack>
          {uploadError !== null ? (
            <div style={{ fontSize: typography.sizes.sm, color: 'var(--nexora-danger)' }}>
              {uploadError.message}
            </div>
          ) : null}
        </Stack>
      </Card>

      {/* Templates (S17) */}
      <section>
        <Stack
          direction="row"
          gap={4}
          align="center"
          justify="space-between"
          style={{ marginBottom: 12 }}
        >
          <h2 style={{ fontSize: typography.sizes.lg, fontWeight: typography.weights.semibold }}>
            Templates
          </h2>
          <TemplateCreator
            organizationId={organizationId}
            workspaceId={workspaceId}
            encodeFile={encodeFile}
            inferContentType={inferContentType}
            onCreated={() => void loadTemplates()}
          />
        </Stack>
        {templates.length === 0 ? (
          <Card>
            <EmptyState
              icon="📄"
              title="No templates yet"
              description="Create a template to start new documents from a fixed structure."
            />
          </Card>
        ) : (
          <Stack gap={3}>
            {templates.map((template) => (
              <TemplateRow
                key={template.id}
                template={template}
                organizationId={organizationId}
                workspaceId={workspaceId}
                onUsed={() => onUploaded()}
                onArchived={() => void loadTemplates()}
              />
            ))}
          </Stack>
        )}
      </section>

      {/* Document list */}
      <section>
        <h2
          style={{
            fontSize: typography.sizes.lg,
            fontWeight: typography.weights.semibold,
            marginBottom: 12,
          }}
        >
          Workspace documents
        </h2>
        {documents.length === 0 ? (
          <Card>
            <EmptyState
              icon="🗂"
              title="No documents yet"
              description="Upload a project plan, then ask the AI: “What does the Mobile Banking project document say about the deadline?”"
            />
          </Card>
        ) : (
          <Stack gap={3}>
            {documents.map((document) => (
              <DocumentRow
                key={document.id}
                document={document}
                organizationId={organizationId}
                workspaceId={workspaceId}
                encodeFile={encodeFile}
                inferContentType={inferContentType}
                onChanged={() => onUploaded()}
              />
            ))}
          </Stack>
        )}
      </section>
    </Stack>
  );
}

/** The create-template control (S17): name + file picker. */
function TemplateCreator({
  organizationId,
  workspaceId,
  encodeFile,
  inferContentType,
  onCreated,
}: {
  organizationId: string;
  workspaceId: string;
  encodeFile: (file: File) => Promise<string>;
  inferContentType: (file: File) => string;
  onCreated: () => void;
}): JSX.Element {
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);

  const handleFile = useCallback(
    async (file: File) => {
      setCreating(true);
      setError(null);
      try {
        await api('/documents/templates', {
          method: 'POST',
          body: JSON.stringify({
            organizationId,
            workspaceId,
            name: file.name,
            contentType: inferContentType(file),
            content: await encodeFile(file),
          }),
        });
        onCreated();
      } catch (caught) {
        setError(
          caught instanceof ApiError
            ? caught
            : new ApiError(0, 'INTERNAL_ERROR', 'Template creation failed'),
        );
      } finally {
        setCreating(false);
      }
    },
    [organizationId, workspaceId, encodeFile, inferContentType, onCreated],
  );

  return (
    <Stack direction="row" gap={3} align="center">
      {error !== null ? (
        <span style={{ fontSize: typography.sizes.xs, color: 'var(--nexora-danger)' }}>
          {error.message}
        </span>
      ) : null}
      <label style={{ display: 'inline-flex', cursor: creating ? 'default' : 'pointer' }}>
        <Button size="sm" variant="secondary" disabled={creating}>
          {creating ? 'Creating…' : '+ New template'}
        </Button>
        <input
          type="file"
          accept=".txt,.md,.markdown,.json,text/plain,text/markdown,application/pdf"
          style={{ display: 'none' }}
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file !== undefined) void handleFile(file);
            event.currentTarget.value = '';
          }}
        />
      </label>
    </Stack>
  );
}

/** A single template row with use/archive actions (S17). */
function TemplateRow({
  template,
  organizationId,
  workspaceId,
  onUsed,
  onArchived,
}: {
  template: DocumentTemplateDto;
  organizationId: string;
  workspaceId: string;
  onUsed: () => void;
  onArchived: () => void;
}): JSX.Element {
  const [title, setTitle] = useState('');
  const [using, setUsing] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);

  const handleUse = useCallback(async () => {
    setUsing(true);
    setError(null);
    try {
      await api('/documents/from-template', {
        method: 'POST',
        body: JSON.stringify({
          organizationId,
          workspaceId,
          templateId: template.id,
          title: title.trim().length > 0 ? title.trim() : template.name,
        }),
      });
      onUsed();
    } catch (caught) {
      setError(
        caught instanceof ApiError
          ? caught
          : new ApiError(0, 'INTERNAL_ERROR', 'Could not use template'),
      );
    } finally {
      setUsing(false);
    }
  }, [organizationId, workspaceId, template.id, template.name, title, onUsed]);

  const handleArchive = useCallback(async () => {
    try {
      await api(`/documents/templates/${template.id}/archive`, {
        method: 'POST',
        body: JSON.stringify({ organizationId, workspaceId }),
      });
      onArchived();
    } catch {
      // The picker simply does not change; the failure is visible via the
      // unchanged list (an archive is a low-frequency action).
    }
  }, [organizationId, workspaceId, template.id, onArchived]);

  return (
    <Card style={{ padding: '14px 16px' }}>
      <Stack
        direction="row"
        gap={3}
        align="center"
        justify="space-between"
        style={{ flexWrap: 'wrap' }}
      >
        <Stack gap={0.5} style={{ minWidth: 0 }}>
          <div style={{ fontWeight: typography.weights.semibold }}>{template.name}</div>
          <div
            style={{
              fontSize: typography.sizes.xs,
              color: 'var(--nexora-textMuted)',
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              maxWidth: 400,
            }}
          >
            {template.contentType}
            {template.description !== undefined ? ` · ${template.description}` : ''}
          </div>
          {error !== null ? (
            <div style={{ fontSize: typography.sizes.xs, color: 'var(--nexora-danger)' }}>
              {error.message}
            </div>
          ) : null}
        </Stack>
        <Stack direction="row" gap={3} align="center">
          <Input
            id={`template-title-${template.id}`}
            name="documentTitle"
            aria-label={`Title for ${template.name}`}
            placeholder="New document title"
            value={title}
            onChange={(event) => setTitle(event.currentTarget.value)}
            style={{ width: 180 }}
          />
          <Button size="sm" onClick={() => void handleUse()} disabled={using} loading={using}>
            Use
          </Button>
          <Button size="sm" variant="ghost" onClick={() => void handleArchive()}>
            Archive
          </Button>
        </Stack>
      </Stack>
    </Card>
  );
}

/** A single document row with version history, new-version upload, and restore (S17). */
export function DocumentRow({
  document,
  organizationId,
  workspaceId,
  encodeFile,
  inferContentType,
  onChanged,
}: {
  document: DocumentDto;
  organizationId: string;
  workspaceId: string;
  encodeFile: (file: File) => Promise<string>;
  inferContentType: (file: File) => string;
  onChanged: () => void;
}): JSX.Element {
  const [versions, setVersions] = useState<DocumentVersionDto[] | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);

  const loadVersions = useCallback(async () => {
    try {
      const listed = await api<{ versions: DocumentVersionDto[] }>(
        `/documents/${document.id}/versions?organizationId=${encodeURIComponent(organizationId)}&workspaceId=${encodeURIComponent(workspaceId)}`,
      );
      setVersions(listed.versions);
    } catch {
      setVersions([]);
    }
  }, [document.id, organizationId, workspaceId]);

  const toggleHistory = useCallback(() => {
    if (!historyOpen && versions === null) {
      void loadVersions();
    }
    setHistoryOpen((open) => !open);
  }, [historyOpen, versions, loadVersions]);
  const handleNewVersion = useCallback(
    async (file: File) => {
      setUploading(true);
      setError(null);
      try {
        await api<{ document: DocumentDto; versionNumber: number }>(
          `/documents/${document.id}/versions`,
          {
            method: 'POST',
            body: JSON.stringify({
              organizationId,
              workspaceId,
              contentType: inferContentType(file),
              content: await encodeFile(file),
            }),
          },
        );
        if (versions !== null) {
          await loadVersions();
        }
        onChanged();
      } catch (caught) {
        setError(
          caught instanceof ApiError
            ? caught
            : new ApiError(0, 'INTERNAL_ERROR', 'Version upload failed'),
        );
      } finally {
        setUploading(false);
      }
    },
    [
      document.id,
      organizationId,
      workspaceId,
      encodeFile,
      inferContentType,
      onChanged,
      versions,
      loadVersions,
    ],
  );

  const handleRestore = useCallback(
    async (version: number) => {
      setError(null);
      try {
        await api<{ versionNumber: number }>(
          `/documents/${document.id}/versions/${version}/restore`,
          {
            method: 'POST',
            body: JSON.stringify({ organizationId, workspaceId }),
          },
        );
        if (versions !== null) {
          await loadVersions();
        }
        onChanged();
      } catch (caught) {
        setError(
          caught instanceof ApiError ? caught : new ApiError(0, 'INTERNAL_ERROR', 'Restore failed'),
        );
      }
    },
    [document.id, organizationId, workspaceId, onChanged, versions, loadVersions],
  );

  return (
    <Card style={{ padding: '14px 16px' }}>
      <Stack gap={3}>
        <Stack
          direction="row"
          gap={3}
          align="center"
          justify="space-between"
          style={{ flexWrap: 'wrap' }}
        >
          <Stack gap={0.5} style={{ minWidth: 0 }}>
            <div style={{ fontWeight: typography.weights.semibold }}>{document.title}</div>
            <div
              style={{
                fontSize: typography.sizes.xs,
                color: 'var(--nexora-textMuted)',
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                maxWidth: 480,
              }}
              title={document.id}
            >
              {document.contentType} · v{document.contentVersion}
            </div>
            {document.status === 'failed' && document.failureReason !== undefined ? (
              <div style={{ fontSize: typography.sizes.xs, color: 'var(--nexora-danger)' }}>
                {document.failureReason}
              </div>
            ) : null}
            {error !== null ? (
              <div style={{ fontSize: typography.sizes.xs, color: 'var(--nexora-danger)' }}>
                {error.message}
              </div>
            ) : null}
          </Stack>
          <Stack direction="row" gap={3} align="center" style={{ flexShrink: 0 }}>
            <DocumentStatusBadge status={document.status} />
            <span
              style={{
                fontSize: typography.sizes.xs,
                color: 'var(--nexora-textMuted)',
                whiteSpace: 'nowrap',
              }}
            >
              {new Date(document.createdAt).toLocaleDateString('en-US', {
                month: 'short',
                day: 'numeric',
                year: 'numeric',
              })}
            </span>
          </Stack>
        </Stack>

        <Stack direction="row" gap={3} align="center">
          <label style={{ display: 'inline-flex', cursor: uploading ? 'default' : 'pointer' }}>
            <Button
              size="sm"
              variant="secondary"
              disabled={uploading || document.status !== 'available'}
            >
              {uploading ? 'Uploading…' : '+ New version'}
            </Button>
            <input
              type="file"
              accept=".txt,.md,.markdown,.json,text/plain,text/markdown,application/pdf"
              style={{ display: 'none' }}
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file !== undefined) void handleNewVersion(file);
                event.currentTarget.value = '';
              }}
            />
          </label>
          <Button size="sm" variant="ghost" onClick={() => void toggleHistory()}>
            {historyOpen ? 'Hide history' : 'History'}
          </Button>
        </Stack>

        {historyOpen ? (
          <VersionHistory
            versions={versions}
            loading={versions === null}
            onRestore={(version) => void handleRestore(version)}
          />
        ) : null}
      </Stack>
    </Card>
  );
}

/** The version-history panel (S17): monotonic revisions with restore. */
function VersionHistory({
  versions,
  loading,
  onRestore,
}: {
  versions: DocumentVersionDto[] | null;
  loading: boolean;
  onRestore: (version: number) => void;
}): JSX.Element {
  if (loading) {
    return <Skeleton height={64} />;
  }
  if (versions === null || versions.length === 0) {
    return (
      <div style={{ fontSize: typography.sizes.sm, color: 'var(--nexora-textMuted)' }}>
        No versions recorded for this document.
      </div>
    );
  }
  // Current = the maximum revision (robust to list ordering).
  const current = Math.max(...versions.map((version) => version.version));
  return (
    <Stack gap={2}>
      {versions.map((version) => {
        const isCurrent = version.version === current;
        return (
          <Stack
            key={version.id}
            direction="row"
            gap={3}
            align="center"
            justify="space-between"
            style={{
              padding: '8px 10px',
              borderRadius: 8,
              background: isCurrent ? 'var(--nexora-surfaceMuted)' : 'transparent',
            }}
          >
            <Stack gap={0.5} style={{ minWidth: 0 }}>
              <div style={{ fontSize: typography.sizes.sm, fontWeight: typography.weights.medium }}>
                v{version.version}
                {isCurrent ? ' (current)' : ''}
                {version.restoredFromVersion !== undefined
                  ? ` · restored from v${version.restoredFromVersion}`
                  : ''}
              </div>
              <div style={{ fontSize: typography.sizes.xs, color: 'var(--nexora-textMuted)' }}>
                {version.contentType} ·{' '}
                {new Date(version.createdAt).toLocaleString('en-US', {
                  month: 'short',
                  day: 'numeric',
                  year: 'numeric',
                })}
              </div>
            </Stack>
            {!isCurrent ? (
              <Button size="sm" variant="ghost" onClick={() => onRestore(version.version)}>
                Restore
              </Button>
            ) : null}
          </Stack>
        );
      })}
    </Stack>
  );
}

/** Maps a document lifecycle status to a tone (loading skeleton for unknown states). */
export function DocumentStatusBadge({ status }: { status: string }): JSX.Element {
  if (status === 'uploaded') {
    return <Badge>Uploaded</Badge>;
  }
  if (status === 'processing') {
    return (
      <Badge tone="warning" dot>
        Processing
      </Badge>
    );
  }
  if (status === 'available') {
    return (
      <Badge tone="success" dot>
        Available
      </Badge>
    );
  }
  if (status === 'failed') {
    return <Badge tone="danger">Failed</Badge>;
  }
  if (status === 'archived') {
    return <Badge>Archived</Badge>;
  }
  return <Skeleton height={18} width={80} />;
}
