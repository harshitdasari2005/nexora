/**
 * @nexora/app-web — Settings page (S27 Phase 6).
 *
 * A small, useful first version built entirely from EXISTING authenticated
 * data — no invented settings: PROFILE (name/email/current role-context,
 * from `/api/me` + `/api/role-context`), ORGANIZATION (active org/workspace,
 * from `/api/dashboard`), PREFERENCES (notification categories, the SAME
 * endpoint the Notification Center preferences panel already uses), and
 * SECURITY (session identity + sign out, the SAME `/api/auth/logout` link
 * already in the sidebar).
 */

import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Avatar, Badge, Button, Card, Stack, typography } from '@nexora/design-system';

import { AppShell } from '../components/AppShell.js';
import { ErrorState } from '../components/ErrorState.js';
import { LoadingScreen } from '../components/LoadingScreen.js';
import { api, ApiError } from '../lib/api.js';
import type {
  DashboardResponse,
  NotificationPreferencesDto,
  RoleContextResponse,
} from '../lib/types.js';
import { useSession } from '../session.js';

const CATEGORY_LABELS: Record<string, string> = {
  workflow: 'Workflow',
  approval: 'Approvals',
  project: 'Projects',
  employee: 'Employees',
  document: 'Documents',
  knowledge: 'Knowledge',
  system: 'System',
};

/** A labeled settings section (consistent card chrome across the page). */
function Section({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
}): JSX.Element {
  return (
    <Card>
      <Stack gap={4}>
        <Stack gap={1}>
          <h2 style={{ fontSize: typography.sizes.lg, fontWeight: typography.weights.semibold }}>
            {title}
          </h2>
          {description !== undefined ? (
            <p style={{ fontSize: typography.sizes.sm, color: 'var(--nexora-textSecondary)' }}>
              {description}
            </p>
          ) : null}
        </Stack>
        {children}
      </Stack>
    </Card>
  );
}

/** A label/value row used throughout the settings sections. */
function Field({ label, value }: { label: string; value: React.ReactNode }): JSX.Element {
  return (
    <Stack
      direction="row"
      gap={4}
      align="center"
      justify="space-between"
      style={{ paddingBlock: 8, borderBottom: '1px solid var(--nexora-border)' }}
    >
      <span style={{ fontSize: typography.sizes.sm, color: 'var(--nexora-textMuted)' }}>
        {label}
      </span>
      <span style={{ fontSize: typography.sizes.sm, fontWeight: typography.weights.medium }}>
        {value}
      </span>
    </Stack>
  );
}

/** The Settings application page (loads shell context + settings data). */
export function Settings(): JSX.Element {
  const { data: session } = useSession();
  const [searchParams] = useSearchParams();

  const [state, setState] = useState<{
    dashboard: DashboardResponse | null;
    roleContext: RoleContextResponse | null;
    preferences: NotificationPreferencesDto | null;
    loading: boolean;
    error: ApiError | null;
  }>({ dashboard: null, roleContext: null, preferences: null, loading: true, error: null });
  const [savingCategory, setSavingCategory] = useState<string | null>(null);

  const scopeSuffix = useCallback(() => {
    const params = new URLSearchParams();
    const organizationId = searchParams.get('organizationId');
    const workspaceId = searchParams.get('workspaceId');
    if (organizationId !== null) params.set('organizationId', organizationId);
    if (workspaceId !== null) params.set('workspaceId', workspaceId);
    const suffix = params.toString();
    return suffix.length > 0 ? `?${suffix}` : '';
  }, [searchParams]);

  const load = useCallback(async () => {
    setState((current) => ({ ...current, loading: true, error: null }));
    try {
      const suffix = scopeSuffix();
      const [dashboard, roleContext, preferences] = await Promise.all([
        api<DashboardResponse>(`/dashboard${suffix}`),
        api<RoleContextResponse>(`/role-context${suffix}`),
        api<{ preferences: NotificationPreferencesDto }>(
          `/notifications/preferences${suffix}`,
        ).then((result) => result.preferences),
      ]);
      setState({ dashboard, roleContext, preferences, loading: false, error: null });
    } catch (error) {
      setState((current) => ({
        ...current,
        loading: false,
        error:
          error instanceof ApiError ? error : new ApiError(0, 'INTERNAL_ERROR', 'Request failed'),
      }));
    }
  }, [scopeSuffix]);

  useEffect(() => {
    void load();
  }, [load]);

  const toggleCategory = useCallback(
    async (category: string, enabled: boolean) => {
      setSavingCategory(category);
      try {
        const updated = await api<{ preferences: NotificationPreferencesDto }>(
          `/notifications/preferences${scopeSuffix()}`,
          { method: 'PUT', body: JSON.stringify({ category, enabled }) },
        );
        setState((current) => ({ ...current, preferences: updated.preferences }));
      } catch {
        // Best-effort — the toggle reverts on the next load if it didn't stick.
      } finally {
        setSavingCategory(null);
      }
    },
    [scopeSuffix],
  );

  if (state.loading && state.dashboard === null) {
    return <LoadingScreen />;
  }
  if (state.error !== null) {
    return <ErrorState message={state.error.message} onRetry={() => void load()} />;
  }
  const { dashboard, roleContext, preferences } = state;
  if (dashboard === null || session === null) {
    return <LoadingScreen />;
  }

  return (
    <AppShell
      user={dashboard.user}
      organizationName={dashboard.organization?.name ?? 'No organization'}
      workspaceName={dashboard.workspace?.name ?? 'No workspace yet'}
      organizationId={dashboard.organization?.id}
      workspaceId={dashboard.workspace?.id}
    >
      <Stack gap={6} style={{ maxWidth: 720, margin: '0 auto' }}>
        <Stack gap={1}>
          <h1 style={{ fontSize: typography.sizes['2xl'], fontWeight: typography.weights.bold }}>
            Settings
          </h1>
          <p style={{ fontSize: typography.sizes.sm, color: 'var(--nexora-textSecondary)' }}>
            Your profile, organization, preferences, and session.
          </p>
        </Stack>

        <Section title="Profile" description="Your identity and current business role.">
          <Stack direction="row" gap={4} align="center">
            <Avatar name={dashboard.user.displayName} size={48} />
            <Stack gap={0.5}>
              <div
                style={{ fontWeight: typography.weights.semibold, fontSize: typography.sizes.md }}
              >
                {dashboard.user.displayName}
              </div>
              <div style={{ fontSize: typography.sizes.sm, color: 'var(--nexora-textMuted)' }}>
                {dashboard.user.email}
              </div>
            </Stack>
          </Stack>
          <Stack gap={0}>
            <Field label="Username" value={dashboard.user.username} />
            <Field
              label="Current role"
              value={
                roleContext?.current !== null && roleContext?.current !== undefined ? (
                  <Badge tone="primary" dot>
                    {roleContext.current.domainName} · {roleContext.current.roleName}
                  </Badge>
                ) : (
                  'Not resolved'
                )
              }
            />
            <Field
              label="Account status"
              value={<Badge tone="success">{dashboard.user.status}</Badge>}
            />
          </Stack>
        </Section>

        <Section
          title="Organization"
          description="The active organization and workspace. Switch context from the sidebar."
        >
          <Stack gap={0}>
            <Field label="Organization" value={dashboard.organization?.name ?? '—'} />
            <Field label="Organization type" value={dashboard.organization?.type ?? '—'} />
            <Field label="Workspace" value={dashboard.workspace?.name ?? '—'} />
            <Field label="Workspace type" value={dashboard.workspace?.type ?? '—'} />
          </Stack>
        </Section>

        <Section
          title="Preferences"
          description="Notification delivery preferences — disables presentation only, never the underlying business action."
        >
          {preferences === null ? (
            <p style={{ fontSize: typography.sizes.sm, color: 'var(--nexora-textMuted)' }}>
              Preferences are unavailable right now.
            </p>
          ) : (
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
                gap: 8,
              }}
            >
              {/* A category with no explicit preference stored is enabled by
                  default (the server's opt-out model) — shown as checked. */}
              {Object.keys(CATEGORY_LABELS)
                .map((category) => [category, preferences.categories[category] ?? true] as const)
                .map(([category, enabled]) => (
                  <label
                    key={category}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                      fontSize: typography.sizes.sm,
                      cursor: savingCategory === category ? 'wait' : 'pointer',
                      opacity: savingCategory === category ? 0.6 : 1,
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={enabled}
                      disabled={savingCategory === category}
                      onChange={(event) => void toggleCategory(category, event.target.checked)}
                    />
                    {CATEGORY_LABELS[category] ?? category}
                  </label>
                ))}
            </div>
          )}
        </Section>

        <Section title="Security" description="Your session.">
          <Stack gap={0}>
            <Field label="Signed in as" value={dashboard.user.email} />
            <Field
              label="Member since"
              value={new Date(dashboard.user.createdAt).toLocaleDateString('en-US', {
                year: 'numeric',
                month: 'long',
                day: 'numeric',
              })}
            />
          </Stack>
          <a href="/api/auth/logout" style={{ textDecoration: 'none', alignSelf: 'flex-start' }}>
            <Button variant="secondary">Sign out</Button>
          </a>
        </Section>
      </Stack>
    </AppShell>
  );
}
