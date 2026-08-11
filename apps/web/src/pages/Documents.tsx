/**
 * @nexora/app-web — Documents page.
 *
 * The Documents + Knowledge application view (FRONTEND.md §7 application
 * experience): lists the documents of the current workspace with loading,
 * empty, and error states, and supports uploading a document. Uploads flow
 * through the same application boundary the AI knowledge capability uses
 * (`POST /api/documents`): store bytes → persist metadata → processing →
 * knowledge index. The page shows the honest processing state — a document
 * is only listed as `available` when its content is actually searchable.
 */

import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  Skeleton,
  Stack,
  typography,
} from '@nexora/design-system';

import { AppShell } from '../components/AppShell.js';
import { ErrorState } from '../components/ErrorState.js';
import { LoadingScreen } from '../components/LoadingScreen.js';
import { api, ApiError } from '../lib/api.js';
import type { DashboardResponse, DocumentDto } from '../lib/types.js';
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
    setState({ dashboard: null, documents: [], loading: true, error: null });
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
      setState({
        dashboard: null,
        documents: [],
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
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<ApiError | null>(null);

  const handleUpload = useCallback(
    async (file: File) => {
      setUploading(true);
      setUploadError(null);
      try {
        const bytes = new Uint8Array(await file.arrayBuffer());
        let binary = '';
        for (const byte of bytes) {
          binary += String.fromCharCode(byte);
        }
        const contentType =
          file.type.length > 0
            ? file.type
            : file.name.endsWith('.pdf')
              ? 'application/pdf'
              : 'text/plain';
        const created = await api<{ document: DocumentDto; indexed: boolean }>('/documents', {
          method: 'POST',
          body: JSON.stringify({
            organizationId,
            workspaceId,
            title: file.name,
            contentType,
            content: btoa(binary),
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
    [organizationId, workspaceId, onUploaded],
  );

  return (
    <Stack gap={8} style={{ maxWidth: 880, margin: '0 auto' }}>
      <Stack direction="row" gap={4} align="center" justify="space-between">
        <Stack gap={1}>
          <h1 style={{ fontSize: typography.sizes['2xl'], fontWeight: typography.weights.bold }}>
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
              <DocumentRow key={document.id} document={document} />
            ))}
          </Stack>
        )}
      </section>
    </Stack>
  );
}

/** A single document row with status display. */
export function DocumentRow({ document }: { document: DocumentDto }): JSX.Element {
  return (
    <Card style={{ padding: '14px 16px' }}>
      <Stack direction="row" gap={4} align="center" justify="space-between">
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
          >
            {document.contentType} · ID {document.id}
          </div>
          {document.status === 'failed' && document.failureReason !== undefined ? (
            <div style={{ fontSize: typography.sizes.xs, color: 'var(--nexora-danger)' }}>
              {document.failureReason}
            </div>
          ) : null}
        </Stack>
        <Stack direction="row" gap={3} align="center">
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
    </Card>
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
