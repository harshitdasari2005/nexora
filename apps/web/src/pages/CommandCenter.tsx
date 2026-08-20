/**
 * @nexora/app-web — Command Center page (S24 Phase 2; S31 premium wow pass).
 *
 * The GENERIC command-center page. There is ONE page for every role: the
 * server resolves the caller's effective business role from trusted
 * membership and returns the composed CommandCenterDefinition + widget data;
 * this page only renders. No CEOPage/ManagerPage/DeveloperPage exists — the
 * role determines the composition, never the page.
 *
 * S31 adds a premium presentation layer ON TOP of the same generic data:
 * a personal greeting + role badge, a deterministic "Nexora Brief" composed
 * from the SAME widget data + the real detected-problems list (no new AI
 * service), a "Needs your attention" section reusing the EXISTING problems
 * endpoint (`fetchProblems`), an AI Assistant entry point, and quick actions
 * to pages that already exist. Nothing here is fabricated: every number and
 * every card traces back to an existing endpoint.
 *
 * Visual hierarchy: greeting → brief → needs attention → AI entry / quick
 * actions → widget grid (KPIs first, hero-weighted, then attention/work/
 * activity). Loading, empty, and error states mirror the other application
 * views.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Link } from 'react-router-dom';
import { Badge, Button, Card, EmptyState, Stack, typography } from '@nexora/design-system';

import { AppShell } from '../components/AppShell.js';
import { CommandCenterWidget } from '../components/CommandCenterWidgets.js';
import { ErrorState } from '../components/ErrorState.js';
import { LoadingScreen } from '../components/LoadingScreen.js';
import { SectionLabel, severityAccent, severityTone } from '../components/ProblemInvestigation.js';
import { api, ApiError } from '../lib/api.js';
import { fetchProblems } from '../lib/problems.js';
import type {
  BusinessProblemDto,
  CommandCenterDto,
  CommandCenterWidgetDto,
  DashboardResponse,
  RoleContextResponse,
} from '../lib/types.js';
import { useSession } from '../session.js';

/** The command-center application page (loads shell context + center). */
export function CommandCenter(): JSX.Element {
  const { data: session } = useSession();
  const [searchParams] = useSearchParams();

  const [state, setState] = useState<{
    dashboard: DashboardResponse | null;
    loading: boolean;
    error: ApiError | null;
  }>({ dashboard: null, loading: true, error: null });

  const load = useCallback(async () => {
    setState({ dashboard: null, loading: true, error: null });
    try {
      const params = new URLSearchParams();
      const organizationId = searchParams.get('organizationId');
      const workspaceId = searchParams.get('workspaceId');
      if (organizationId !== null) params.set('organizationId', organizationId);
      if (workspaceId !== null) params.set('workspaceId', workspaceId);
      const suffix = params.size > 0 ? `?${params.toString()}` : '';
      const dashboard = await api<DashboardResponse>(`/dashboard${suffix}`);
      setState({ dashboard, loading: false, error: null });
    } catch (error) {
      setState({
        dashboard: null,
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
            icon="◎"
            title="Create a workspace first"
            description="The Command Center is composed per workspace. Set one up to see your role-aware workspace."
            action={
              <Button variant="secondary" onClick={() => void load()}>
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
      <CommandCenterView
        organizationId={dashboard.organization.id}
        workspaceId={dashboard.workspace.id}
        organizationName={dashboard.organization.name}
        userDisplayName={dashboard.user.displayName}
      />
    </AppShell>
  );
}

/** Time-of-day greeting (reused from the Dashboard convention). */
function greeting(now: Date = new Date()): string {
  const hour = now.getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 18) return 'Good afternoon';
  return 'Good evening';
}

/** Extracts a success-rate percentage from a status string like "94% success". */
function parseSuccessRate(status: string | undefined): number | undefined {
  if (status === undefined) return undefined;
  const match = /^(\d+(?:\.\d+)?)%\s*success$/i.exec(status.trim());
  if (match?.[1] === undefined) return undefined;
  const value = Number(match[1]);
  return Number.isFinite(value) ? value : undefined;
}

/** Composes the deterministic "Nexora Brief" from real widget + problem data. */
function composeBrief(
  organizationName: string,
  center: CommandCenterDto | null,
  problems: readonly BusinessProblemDto[] | null,
): string {
  if (center === null) {
    return `${organizationName} is set up — your role-aware workspace is ready.`;
  }
  const high = problems?.filter((p) => p.severity === 'high').length ?? 0;
  const medium = problems?.filter((p) => p.severity === 'medium').length ?? 0;
  const total = problems?.length ?? 0;

  // Average success rate across every workflow-health list widget, when one
  // is configured for this role — a real derived number, never invented.
  let workflowNote = '';
  for (const widget of center.widgets) {
    const data = center.data[widget.id];
    if (data?.kind !== 'list') continue;
    const rates = data.items
      .map((item) => parseSuccessRate(item.status))
      .filter((n): n is number => n !== undefined);
    if (rates.length === 0) continue;
    const avg = Math.round(rates.reduce((sum, n) => sum + n, 0) / rates.length);
    workflowNote = ` Workflow health is averaging ${avg}%.`;
    break;
  }

  if (total === 0) {
    return `${organizationName} is operating normally overall — nothing needs your attention right now.${workflowNote}`;
  }
  const parts: string[] = [];
  if (high > 0) parts.push(`${high} require immediate attention`);
  if (medium > 0) parts.push(`${medium} need a decision soon`);
  const detail = parts.length > 0 ? parts.join(' and ') : `${total} are worth a look`;
  const noun = total === 1 ? 'issue' : 'issues';
  return `${organizationName} has ${total} open ${noun} — ${detail}.${workflowNote}`;
}

/** Props of {@link CommandCenterView}. */
export interface CommandCenterViewProps {
  /** The current organization id (trusted scope). */
  organizationId: string;
  /** The current workspace id (trusted scope). */
  workspaceId: string;
  /** The current organization name. */
  organizationName: string;
  /** The current user's display name (greeting). */
  userDisplayName?: string;
  /** Optional preloaded center (server-rendered smoke tests). */
  initialCenter?: CommandCenterDto | null;
}

/** The pure command-center content (exported for smoke tests). */
export function CommandCenterView({
  organizationId,
  workspaceId,
  organizationName,
  userDisplayName,
  initialCenter,
}: CommandCenterViewProps): JSX.Element {
  const [center, setCenter] = useState<CommandCenterDto | null>(initialCenter ?? null);
  // When the prop is absent the view loads from the API; smoke tests pass an
  // initial value (or null for the empty state) and skip the network fetch.
  const [loading, setLoading] = useState(initialCenter === undefined);
  const [error, setError] = useState<ApiError | null>(null);
  const [roleContext, setRoleContext] = useState<RoleContextResponse | null>(null);
  const [problems, setProblems] = useState<readonly BusinessProblemDto[] | null>(null);
  // Cross-fades the content on role/workspace switch instead of a loading
  // screen — set true just before a NON-initial refetch, cleared once the
  // new center has painted.
  const [morphing, setMorphing] = useState(false);
  const firstLoadRef = useRef(true);

  const load = useCallback(async () => {
    if (!firstLoadRef.current) {
      setMorphing(true);
    }
    setError(null);
    try {
      const scope = `organizationId=${encodeURIComponent(organizationId)}&workspaceId=${encodeURIComponent(workspaceId)}`;
      const [center, context, problemList] = await Promise.all([
        api<CommandCenterDto>(`/command-center?${scope}`),
        api<RoleContextResponse>(`/role-context?${scope}`).catch(() => null),
        fetchProblems({ organizationId, workspaceId }).catch(() => null),
      ]);
      setCenter(center);
      setRoleContext(context);
      setProblems(problemList);
    } catch (caught) {
      setError(
        caught instanceof ApiError ? caught : new ApiError(0, 'INTERNAL_ERROR', 'Request failed'),
      );
    } finally {
      setLoading(false);
      firstLoadRef.current = false;
      // Let the new content mount at opacity 0, then release the morph on
      // the next frame so the cross-fade actually plays.
      requestAnimationFrame(() => requestAnimationFrame(() => setMorphing(false)));
    }
  }, [organizationId, workspaceId]);

  useEffect(() => {
    if (initialCenter === undefined) {
      void load();
    }
  }, [load, initialCenter]);

  const firstName = userDisplayName?.split(' ')[0];
  const currentRole = roleContext?.current;
  const roleLabel =
    currentRole !== undefined && currentRole !== null
      ? `${currentRole.domainName} · ${currentRole.roleName}`
      : center !== null
        ? `${center.domainName} · ${center.roleName}`
        : undefined;

  // Resolved problems have already been dealt with — they belong in history,
  // not in "needs your attention" or the open-issue counts.
  const openProblems = problems?.filter((p) => p.status !== 'RESOLVED') ?? null;
  const sortedProblems =
    openProblems === null
      ? null
      : [...openProblems]
          .sort((a, b) => severityRank(b.severity) - severityRank(a.severity))
          .slice(0, 3);

  return (
    <div style={{ position: 'relative' }}>
      {/* The ambient intelligence-network background is now owned by AppShell
          (one shared canvas for the whole authenticated app, tinted per
          page) — rendering a second one here would double the animation
          cost and the visual density for no benefit. */}
      <Stack gap={6} style={{ maxWidth: 1080, margin: '0 auto', position: 'relative', zIndex: 1 }}>
        {/* Greeting header */}
        <Stack gap={2}>
          <div
            style={{
              fontSize: typography.sizes.xs,
              fontWeight: typography.weights.semibold,
              color: 'var(--nexora-textMuted)',
              textTransform: 'uppercase',
              letterSpacing: '0.08em',
            }}
          >
            Command Center
          </div>
          <Stack direction="row" gap={3} align="center" style={{ flexWrap: 'wrap' }}>
            <h1
              style={{
                fontSize: typography.sizes['3xl'],
                fontWeight: typography.weights.bold,
                letterSpacing: '-0.01em',
              }}
            >
              {greeting()}
              {firstName !== undefined ? `, ${firstName}` : ''}.
            </h1>
            {roleLabel !== undefined ? (
              <Badge tone="primary" dot>
                {roleLabel}
              </Badge>
            ) : null}
          </Stack>
          <p style={{ fontSize: typography.sizes.md, color: 'var(--nexora-textSecondary)' }}>
            {organizationName} · Here&apos;s what needs your attention today.
          </p>
        </Stack>

        {error !== null ? (
          <Card>
            <div style={{ fontSize: typography.sizes.sm, color: 'var(--nexora-danger)' }}>
              {error.message}
            </div>
          </Card>
        ) : null}

        {loading ? (
          <Card>
            <EmptyState
              icon="◎"
              title="Composing your command center…"
              description="Please wait."
            />
          </Card>
        ) : center === null ? (
          <Card>
            <EmptyState
              icon="◎"
              title="No command center yet"
              description="Your role does not have a command center configured."
            />
          </Card>
        ) : (
          <div
            style={{
              opacity: morphing ? 0 : 1,
              transform: morphing ? 'scale(0.985) translateY(10px)' : 'scale(1) translateY(0)',
              filter: morphing ? 'blur(3px)' : 'blur(0px)',
              transition:
                'opacity 700ms cubic-bezier(0.16,1,0.3,1), transform 700ms cubic-bezier(0.16,1,0.3,1), filter 700ms cubic-bezier(0.16,1,0.3,1)',
            }}
          >
            <Stack gap={6}>
              {/* Nexora Brief */}
              <Card
                style={{
                  background:
                    'linear-gradient(135deg, var(--nexora-aiSoft), var(--nexora-primarySoft))',
                  border: '1px solid var(--nexora-border)',
                }}
              >
                <Stack direction="row" gap={4} align="flex-start" style={{ flexWrap: 'wrap' }}>
                  <span
                    aria-hidden
                    style={{
                      width: 36,
                      height: 36,
                      borderRadius: 10,
                      background: 'linear-gradient(135deg, #6366f1, #7c3aed)',
                      display: 'inline-flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: 16,
                      flexShrink: 0,
                      color: '#fff',
                    }}
                  >
                    ✦
                  </span>
                  <Stack gap={2} style={{ flex: 1, minWidth: 240 }}>
                    <div
                      style={{
                        fontSize: typography.sizes.xs,
                        fontWeight: typography.weights.semibold,
                        color: 'var(--nexora-ai)',
                        textTransform: 'uppercase',
                        letterSpacing: '0.06em',
                      }}
                    >
                      Nexora Brief
                    </div>
                    <p
                      style={{
                        fontSize: typography.sizes.base,
                        lineHeight: typography.lineHeights.relaxed,
                      }}
                    >
                      {composeBrief(organizationName, center, openProblems)}
                    </p>
                    {sortedProblems !== null && sortedProblems.length > 0 ? (
                      <Link to="/app/problems" style={{ textDecoration: 'none' }}>
                        <Button variant="secondary" size="sm">
                          Review issues →
                        </Button>
                      </Link>
                    ) : null}
                  </Stack>
                </Stack>
              </Card>

              {/* Needs your attention — real detected problems, ranked by severity */}
              {sortedProblems !== null && sortedProblems.length > 0 ? (
                <Stack gap={3}>
                  <h2
                    style={{
                      fontSize: typography.sizes.lg,
                      fontWeight: typography.weights.semibold,
                    }}
                  >
                    Needs your attention
                  </h2>
                  <Stack gap={3}>
                    {sortedProblems.map((problem) => (
                      <ProblemAttentionCard key={problem.id} problem={problem} />
                    ))}
                  </Stack>
                </Stack>
              ) : null}

              {/* AI entry + quick actions */}
              <Stack direction="row" gap={4} style={{ flexWrap: 'wrap' }}>
                <Card style={{ flex: '2 1 320px', minWidth: 280 }}>
                  <Stack gap={3}>
                    <div
                      style={{
                        fontSize: typography.sizes.xs,
                        fontWeight: typography.weights.semibold,
                        color: 'var(--nexora-textMuted)',
                        textTransform: 'uppercase',
                        letterSpacing: '0.06em',
                      }}
                    >
                      Ask Nexora
                    </div>
                    <p
                      style={{
                        fontSize: typography.sizes.base,
                        fontWeight: typography.weights.medium,
                      }}
                    >
                      &ldquo;What needs my attention?&rdquo;
                    </p>
                    <Stack direction="row" gap={2} style={{ flexWrap: 'wrap' }}>
                      <Link to="/app/assistant" style={{ textDecoration: 'none' }}>
                        <Button size="sm">Ask Nexora</Button>
                      </Link>
                      <Link to="/app/problems" style={{ textDecoration: 'none' }}>
                        <Button variant="secondary" size="sm">
                          Which projects are at risk?
                        </Button>
                      </Link>
                    </Stack>
                  </Stack>
                </Card>

                <Card style={{ flex: '1 1 240px', minWidth: 240 }}>
                  <Stack gap={3}>
                    <div
                      style={{
                        fontSize: typography.sizes.xs,
                        fontWeight: typography.weights.semibold,
                        color: 'var(--nexora-textMuted)',
                        textTransform: 'uppercase',
                        letterSpacing: '0.06em',
                      }}
                    >
                      Quick actions
                    </div>
                    <Stack gap={2}>
                      <Link to="/app/problems" style={{ textDecoration: 'none', color: 'inherit' }}>
                        <QuickAction icon="⚠" label="Investigate problems" />
                      </Link>
                      <Link
                        to="/app/assistant"
                        style={{ textDecoration: 'none', color: 'inherit' }}
                      >
                        <QuickAction icon="✦" label="Ask Nexora" />
                      </Link>
                      <Link
                        to="/app/workflows"
                        style={{ textDecoration: 'none', color: 'inherit' }}
                      >
                        <QuickAction icon="⧉" label="Review workflows" />
                      </Link>
                    </Stack>
                  </Stack>
                </Card>
              </Stack>

              {/* Actions (read/navigation only in Phase 2) */}
              {center.actions.length > 0 ? (
                <Stack direction="row" gap={2} style={{ flexWrap: 'wrap' }}>
                  {center.actions.map((action) => (
                    <Link key={action.id} to={action.href} style={{ textDecoration: 'none' }}>
                      <Button variant="secondary" size="sm">
                        {action.icon !== undefined ? `${action.icon} ` : ''}
                        {action.label}
                      </Button>
                    </Link>
                  ))}
                </Stack>
              ) : null}

              {/* Widget grid: role-composed, one renderer per widget type. The
                  first KPI widget gets hero visual weight — the most
                  important number should dominate, not blend into a grid of
                  identical cards. */}
              <WidgetGrid center={center} />
            </Stack>
          </div>
        )}
      </Stack>

      <style>{`
        .nexora-quick-action:hover { background: var(--nexora-surfaceMuted); }
      `}</style>
    </div>
  );
}

/** Ranks severity for sorting (high first). */
function severityRank(severity: BusinessProblemDto['severity']): number {
  if (severity === 'high') return 2;
  if (severity === 'medium') return 1;
  return 0;
}

/** A single quick-action row. */
function QuickAction({ icon, label }: { icon: string; label: string }): JSX.Element {
  return (
    <Stack
      direction="row"
      gap={2}
      align="center"
      className="nexora-quick-action"
      style={{
        padding: '8px 10px',
        borderRadius: 8,
        transition: 'background 140ms ease',
      }}
    >
      <span aria-hidden style={{ width: 18, textAlign: 'center' }}>
        {icon}
      </span>
      <span style={{ fontSize: typography.sizes.sm, fontWeight: typography.weights.medium }}>
        {label}
      </span>
    </Stack>
  );
}

/** One "needs your attention" problem card — severity, why it matters, recommendation. */
function ProblemAttentionCard({ problem }: { problem: BusinessProblemDto }): JSX.Element {
  return (
    <Card
      interactive
      style={{
        borderLeft: `3px solid ${severityAccent(problem.severity)}`,
        paddingLeft: 18,
      }}
    >
      <Stack gap={2}>
        <Stack direction="row" gap={2} align="center" style={{ flexWrap: 'wrap' }}>
          <Badge tone={severityTone(problem.severity)}>{problem.severity.toUpperCase()}</Badge>
          <span
            style={{ fontWeight: typography.weights.semibold, fontSize: typography.sizes.base }}
          >
            {problem.title}
          </span>
        </Stack>
        <p style={{ fontSize: typography.sizes.sm, color: 'var(--nexora-textSecondary)' }}>
          {problem.description}
        </p>
        {problem.recommendation !== undefined ? (
          <p style={{ fontSize: typography.sizes.sm, color: 'var(--nexora-text)' }}>
            <strong>Nexora recommends:</strong> {problem.recommendation.summary}
          </p>
        ) : null}
        <div>
          <Link to="/app/problems" style={{ textDecoration: 'none' }}>
            <Button variant="secondary" size="sm">
              Investigate
            </Button>
          </Link>
        </div>
      </Stack>
    </Card>
  );
}

/**
 * The widget grid — grouped into labeled sections (BUSINESS HEALTH / BUSINESS
 * SIGNALS / RECENT ACTIVITY) instead of one undifferentiated wall of
 * identical cards. The grouping is purely presentational: it sorts the SAME
 * role-composed widgets by their existing `type`, fabricating nothing. The
 * first KPI widget keeps hero visual weight.
 */
function WidgetGrid({ center }: { center: CommandCenterDto }): JSX.Element {
  const heroId = center.widgets.find((w) => w.type === 'kpi')?.id;
  const health = center.widgets.filter((w) => w.type === 'kpi');
  const signals = center.widgets.filter((w) => w.type === 'list' || w.type === 'attention');
  const activity = center.widgets.filter((w) => w.type === 'activity');

  const renderGroup = (widgets: readonly CommandCenterWidgetDto[]): JSX.Element => (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 16 }}>
      {widgets.map((widget) => (
        <CommandCenterWidget
          key={widget.id}
          widget={widget}
          data={center.data[widget.id]}
          hero={widget.id === heroId}
        />
      ))}
    </div>
  );

  return (
    <Stack gap={6}>
      {health.length > 0 ? (
        <Stack gap={3}>
          <SectionLabel>Business health</SectionLabel>
          {renderGroup(health)}
        </Stack>
      ) : null}
      {signals.length > 0 ? (
        <Stack gap={3}>
          <SectionLabel>Business signals</SectionLabel>
          {renderGroup(signals)}
        </Stack>
      ) : null}
      {activity.length > 0 ? (
        <Stack gap={3}>
          <SectionLabel>Recent activity</SectionLabel>
          {renderGroup(activity)}
        </Stack>
      ) : null}
    </Stack>
  );
}
