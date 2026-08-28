/**
 * @nexora/app-web — Dashboard.
 *
 * The onboarding entry point ONLY (FRONTEND.md §5): `/app` is where an
 * authenticated session lands first, but a caller who already belongs to an
 * organization is sent straight through to Command Center — that page
 * covers everything this one used to show (the same greeting, the same
 * organization/workspace identity) plus the actual business content
 * (health, attention, activity). Two near-identical "home" screens was
 * exactly the kind of duplication a first-time user trips on: which one is
 * the real home? (First-time-user usability audit.) This page still does
 * real work for the one case Command Center doesn't handle — no
 * organization yet — where it hands off to the organization-creation flow.
 */

import { useCallback, useEffect, useState } from 'react';
import { Link, Navigate, useSearchParams } from 'react-router-dom';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  Skeleton,
  Stack,
  typography,
} from '@nexora/design-system';

import { ActivityFeed } from '../components/ActivityFeed.js';
import { ErrorState } from '../components/ErrorState.js';
import { LoadingScreen } from '../components/LoadingScreen.js';
import { api, ApiError } from '../lib/api.js';
import type { DashboardResponse } from '../lib/types.js';
import { useSession } from '../session.js';

/** The dashboard page (fetches the read model). */
export function Dashboard(): JSX.Element {
  const { data: session } = useSession();
  const [searchParams] = useSearchParams();

  const [state, setState] = useState<{
    data: DashboardResponse | null;
    loading: boolean;
    error: ApiError | null;
  }>({ data: null, loading: true, error: null });

  const load = useCallback(async () => {
    // Keeps any already-loaded data visible while refetching — a role
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
      const data = await api<DashboardResponse>(`/dashboard${suffix}`);
      setState({ data, loading: false, error: null });
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

  if (state.loading && state.data === null) {
    return <LoadingScreen />;
  }
  if (state.error !== null) {
    return <ErrorState message={state.error.message} onRetry={() => void load()} />;
  }
  const data = state.data;
  if (data === null || session === null) {
    return <LoadingScreen />;
  }

  if (data.organization !== null) {
    // Already onboarded — Command Center is the real home; this page's own
    // job is only the pre-onboarding welcome screen below.
    return (
      <Navigate to={{ pathname: '/app/command-center', search: searchParams.toString() }} replace />
    );
  }

  // The user has not onboarded yet.
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
          title="Welcome to Nexora"
          description="Create your organization to get started. Your workspace, apps, and AI agents will live here."
          action={
            <Link to="/onboarding/organization">
              <Button size="lg">Create your organization</Button>
            </Link>
          }
        />
      </Card>
    </div>
  );
}

/** The pure dashboard content (exported for smoke tests). */
export function DashboardView({ data }: { data: DashboardResponse }): JSX.Element {
  const { user, organization, workspace } = data;
  return (
    <Stack gap={8} style={{ maxWidth: 880, margin: '0 auto' }}>
      {/* Greeting */}
      <Stack gap={1}>
        <h1 style={{ fontSize: typography.sizes['2xl'], fontWeight: typography.weights.bold }}>
          {greeting()}, {user.displayName.split(' ')[0]}
        </h1>
        <p style={{ fontSize: typography.sizes.sm, color: 'var(--nexora-textSecondary)' }}>
          {new Date().toLocaleDateString('en-US', {
            weekday: 'long',
            month: 'long',
            day: 'numeric',
          })}
        </p>
      </Stack>

      {/* Context cards */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
          gap: 16,
        }}
      >
        <Card>
          <Stack gap={3}>
            <span style={{ fontSize: typography.sizes.xs, color: 'var(--nexora-textMuted)' }}>
              Organization
            </span>
            {organization === null ? (
              <Skeleton height={20} width={140} />
            ) : (
              <>
                <div
                  style={{ fontWeight: typography.weights.semibold, fontSize: typography.sizes.md }}
                >
                  {organization.name}
                </div>
                <Stack direction="row" gap={2} align="center">
                  <Badge tone="primary" dot>
                    {organization.type}
                  </Badge>
                  <Badge tone="success">{organization.status}</Badge>
                </Stack>
                <span style={{ fontSize: typography.sizes.xs, color: 'var(--nexora-textMuted)' }}>
                  {organization.slug}
                </span>
              </>
            )}
          </Stack>
        </Card>

        <Card>
          <Stack gap={3}>
            <span style={{ fontSize: typography.sizes.xs, color: 'var(--nexora-textMuted)' }}>
              Workspace
            </span>
            {workspace === null ? (
              <Skeleton height={20} width={140} />
            ) : (
              <>
                <div
                  style={{ fontWeight: typography.weights.semibold, fontSize: typography.sizes.md }}
                >
                  {workspace.name}
                </div>
                <Stack direction="row" gap={2} align="center">
                  <Badge tone="primary" dot>
                    {workspace.type}
                  </Badge>
                  <Badge tone="success">{workspace.status}</Badge>
                </Stack>
                <span style={{ fontSize: typography.sizes.xs, color: 'var(--nexora-textMuted)' }}>
                  {workspace.slug}
                </span>
              </>
            )}
          </Stack>
        </Card>
      </div>

      {/* AI assistant placeholder */}
      <Card
        style={{
          borderColor: 'transparent',
          background:
            'linear-gradient(135deg, rgba(99,102,241,0.10), rgba(124,58,237,0.14)), var(--nexora-surface)',
        }}
      >
        <Stack gap={4}>
          <Stack direction="row" gap={3} align="center">
            <span
              aria-hidden
              style={{
                width: 40,
                height: 40,
                borderRadius: 12,
                background: 'linear-gradient(135deg, #6366f1, #7c3aed)',
                color: '#fff',
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 18,
              }}
            >
              ✦
            </span>
            <Stack gap={0.5}>
              <div style={{ fontWeight: typography.weights.semibold }}>Nexora AI</div>
              <div style={{ fontSize: typography.sizes.xs, color: 'var(--nexora-textMuted)' }}>
                The enterprise AI orchestrator lands in Phase 2.
              </div>
            </Stack>
          </Stack>
          <div
            aria-disabled
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '10px 14px',
              borderRadius: 12,
              border: '1px dashed var(--nexora-borderStrong)',
              color: 'var(--nexora-textMuted)',
              fontSize: typography.sizes.sm,
            }}
          >
            <span>“Hire Priya and assign her to the Mobile Banking project…”</span>
            <span>⌘K</span>
          </div>
        </Stack>
      </Card>

      {/* Installed apps */}
      <section>
        <h2
          style={{
            fontSize: typography.sizes.lg,
            fontWeight: typography.weights.semibold,
            marginBottom: 12,
          }}
        >
          Installed apps
        </h2>
        <Card>
          <EmptyState
            icon="🧩"
            title="No apps installed yet"
            description="The marketplace arrives in Phase 2 — install HR, Projects, CRM, Finance, and more without changing the platform."
            action={
              <Button variant="secondary" disabled>
                Marketplace coming soon
              </Button>
            }
          />
        </Card>
      </section>

      {/* Recent activity (event-derived read model) */}
      <section>
        <h2
          style={{
            fontSize: typography.sizes.lg,
            fontWeight: typography.weights.semibold,
            marginBottom: 12,
          }}
        >
          Recent activity
        </h2>
        {organization === null ? null : (
          <ActivityFeed organizationId={organization.id} workspaceId={workspace?.id} />
        )}
      </section>
    </Stack>
  );
}

/** Time-of-day greeting. */
export function greeting(now: Date = new Date()): string {
  const hour = now.getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 18) return 'Good afternoon';
  return 'Good evening';
}
