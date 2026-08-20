/**
 * @nexora/app-web — Projects page.
 *
 * The first business application view (Projects vertical slice; FRONTEND.md
 * §7 application experience): lists the projects of the current organization
 * with a create form, plus loading, empty, and error states. The page talks
 * to the same application layer the AI uses (`POST /api/projects` /
 * `GET /api/projects`) — one business execution path for humans and agents.
 */

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  Field,
  Input,
  Skeleton,
  Stack,
  typography,
} from '@nexora/design-system';

import { AppShell } from '../components/AppShell.js';
import { ErrorState } from '../components/ErrorState.js';
import { LoadingScreen } from '../components/LoadingScreen.js';
import { api, ApiError } from '../lib/api.js';
import type { DashboardResponse, ProjectDto } from '../lib/types.js';
import { useSession } from '../session.js';

/** The projects application page. */
export function Projects(): JSX.Element {
  const { data: session } = useSession();
  const [searchParams] = useSearchParams();

  const [state, setState] = useState<{
    dashboard: DashboardResponse | null;
    projects: ProjectDto[];
    loading: boolean;
    error: ApiError | null;
  }>({ dashboard: null, projects: [], loading: true, error: null });

  const load = useCallback(
    async (options?: { silent?: boolean }) => {
      // Silent reloads (e.g. after a create) keep the current view mounted and
      // refresh data in the background — the full-screen loading state only
      // appears on the true first fetch. Non-silent reloads (including a
      // role switch, which re-runs this same effect) still keep any
      // already-loaded dashboard visible — nulling it here would unmount
      // AppShell (sidebar included) on every switch.
      if (options?.silent !== true) {
        setState((current) => ({ ...current, loading: true, error: null }));
      }
      try {
        const params = new URLSearchParams();
        const organizationId = searchParams.get('organizationId');
        if (organizationId !== null) params.set('organizationId', organizationId);
        const suffix = params.size > 0 ? `?${params.toString()}` : '';
        const dashboard = await api<DashboardResponse>(`/dashboard${suffix}`);
        if (dashboard.organization === null) {
          setState({ dashboard, projects: [], loading: false, error: null });
          return;
        }
        const listed = await api<{ projects: ProjectDto[] }>(
          `/projects?organizationId=${encodeURIComponent(dashboard.organization.id)}`,
        );
        setState({ dashboard, projects: listed.projects, loading: false, error: null });
      } catch (error) {
        // On a silent (background) reload, leave the mounted view intact: a
        // refresh failure must not replace visible content with a full-page
        // ErrorState. Non-silent failures surface the error state as usual.
        if (options?.silent === true) {
          return;
        }
        setState((current) => ({
          ...current,
          loading: false,
          error:
            error instanceof ApiError ? error : new ApiError(0, 'INTERNAL_ERROR', 'Request failed'),
        }));
      }
    },
    [searchParams],
  );

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
  if (dashboard.organization === null) {
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
            icon="🚀"
            title="Create your organization first"
            description="Projects live inside an organization. Set one up to get started."
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
      workspaceName={dashboard.workspace?.name ?? 'No workspace yet'}
      organizationId={dashboard.organization.id}
      workspaceId={dashboard.workspace?.id}
    >
      <ProjectsView
        organizationId={dashboard.organization.id}
        organizationName={dashboard.organization.name}
        initialProjects={state.projects}
        onCreated={() => void load({ silent: true })}
      />
    </AppShell>
  );
}

/** Props of {@link ProjectsView}. */
export interface ProjectsViewProps {
  /** The current organization (tenant) id. */
  organizationId: string;
  /** The current organization name (create-form context). */
  organizationName: string;
  /** The projects to render. */
  initialProjects: readonly ProjectDto[];
  /** Called after a project is created (refetch). */
  onCreated: () => void;
}

/** The pure projects content (exported for smoke tests). */
export function ProjectsView({
  organizationId,
  organizationName,
  initialProjects,
  onCreated,
}: ProjectsViewProps): JSX.Element {
  const [projects, setProjects] = useState<ProjectDto[]>(() => [...initialProjects]);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [issues, setIssues] = useState<{ field: string; message: string }[]>([]);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const handleCreate = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    const validation: { field: string; message: string }[] = [];
    if (name.trim().length === 0) {
      validation.push({ field: 'name', message: 'A project name is required' });
    } else if (name.trim().length > 80) {
      validation.push({ field: 'name', message: 'Must be at most 80 characters' });
    }
    setIssues(validation);
    if (validation.length > 0) {
      return;
    }
    setCreating(true);
    setSubmitError(null);
    try {
      const created = await api<{ project: ProjectDto }>('/projects', {
        method: 'POST',
        body: JSON.stringify({
          organizationId,
          name: name.trim(),
          description: description.trim() === '' ? undefined : description.trim(),
        }),
      });
      setProjects((previous) => [created.project, ...previous]);
      setName('');
      setDescription('');
      onCreated();
    } catch (error) {
      setSubmitError(error instanceof ApiError ? error.message : 'Could not create the project.');
    } finally {
      setCreating(false);
    }
  };

  const issueFor = (field: string): string | undefined =>
    issues.find((issue) => issue.field === field)?.message;

  return (
    <Stack gap={8} style={{ maxWidth: 880, margin: '0 auto' }}>
      <Stack direction="row" gap={4} align="center" justify="space-between">
        <Stack gap={1}>
          <h1 style={{ fontSize: typography.sizes['2xl'], fontWeight: typography.weights.bold }}>
            Projects
          </h1>
          <p style={{ fontSize: typography.sizes.sm, color: 'var(--nexora-textSecondary)' }}>
            {organizationName}
          </p>
        </Stack>
        <Badge tone="primary" dot>
          {projects.length} {projects.length === 1 ? 'project' : 'projects'}
        </Badge>
      </Stack>

      {/* Create form */}
      <Card>
        <form onSubmit={(event) => void handleCreate(event)}>
          <Stack gap={4} stretch>
            <Stack gap={1}>
              <div style={{ fontWeight: typography.weights.semibold }}>New project</div>
              <div style={{ fontSize: typography.sizes.xs, color: 'var(--nexora-textMuted)' }}>
                The AI can also create projects — “Create a project called Mobile Banking”.
              </div>
            </Stack>
            <Stack direction="row" gap={3} stretch>
              <div style={{ flex: 1 }}>
                <Field label="Name" required error={issueFor('name')}>
                  <Input
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                    placeholder="Mobile Banking"
                    invalid={issueFor('name') !== undefined}
                  />
                </Field>
              </div>
              <div style={{ flex: 1.5 }}>
                <Field label="Description (optional)">
                  <Input
                    value={description}
                    onChange={(event) => setDescription(event.target.value)}
                    placeholder="What is this project about?"
                  />
                </Field>
              </div>
            </Stack>
            {submitError !== null ? (
              <p style={{ fontSize: typography.sizes.sm, color: 'var(--nexora-danger)' }}>
                {submitError}
              </p>
            ) : null}
            <Button type="submit" size="sm" loading={creating} disabled={creating}>
              {creating ? 'Creating…' : 'Create project'}
            </Button>
          </Stack>
        </form>
      </Card>

      {/* Project list */}
      <section>
        <h2
          style={{
            fontSize: typography.sizes.lg,
            fontWeight: typography.weights.semibold,
            marginBottom: 12,
          }}
        >
          All projects
        </h2>
        {projects.length === 0 ? (
          <Card>
            <EmptyState
              icon="▤"
              title="No projects yet"
              description="Create your first project above, or ask the AI: “Create a project called Mobile Banking.”"
            />
          </Card>
        ) : (
          <Stack gap={3}>
            {projects.map((project) => (
              <ProjectRow key={project.id} project={project} />
            ))}
          </Stack>
        )}
      </section>
    </Stack>
  );
}

/** A single project row with status display. */
export function ProjectRow({ project }: { project: ProjectDto }): JSX.Element {
  return (
    <Card style={{ padding: '14px 16px' }}>
      <Stack
        direction="row"
        gap={3}
        align="center"
        justify="space-between"
        style={{ flexWrap: 'wrap' }}
      >
        <Stack gap={0.5} style={{ minWidth: 0, flex: '1 1 200px' }}>
          <div style={{ fontWeight: typography.weights.semibold }}>{project.name}</div>
          {project.description !== undefined && project.description.length > 0 ? (
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
              {project.description}
            </div>
          ) : (
            <div style={{ fontSize: typography.sizes.xs, color: 'var(--nexora-textMuted)' }}>
              No description
            </div>
          )}
        </Stack>
        <Stack direction="row" gap={3} align="center" style={{ flexShrink: 0 }}>
          <ProjectStatusBadge status={project.status} />
          <span
            style={{
              fontSize: typography.sizes.xs,
              color: 'var(--nexora-textMuted)',
              whiteSpace: 'nowrap',
            }}
          >
            {new Date(project.createdAt).toLocaleDateString('en-US', {
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

/** Maps a project status to a tone (loading skeleton for unknown states). */
export function ProjectStatusBadge({ status }: { status: string }): JSX.Element {
  if (status === 'proposed') {
    return <Badge>Proposed</Badge>;
  }
  if (status === 'active') {
    return (
      <Badge tone="success" dot>
        Active
      </Badge>
    );
  }
  if (status === 'on_hold') {
    return <Badge tone="warning">On hold</Badge>;
  }
  if (status === 'completed') {
    return <Badge tone="primary">Completed</Badge>;
  }
  if (status === 'archived') {
    return <Badge>Archived</Badge>;
  }
  if (status === 'cancelled') {
    return <Badge tone="danger">Cancelled</Badge>;
  }
  return <Skeleton height={18} width={70} />;
}
