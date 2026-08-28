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
import {
  humanizeProblemText,
  humanizeProblemTitle,
  humanizeRecommendationSummary,
} from '../lib/humanize.js';
import { fetchProblems } from '../lib/problems.js';
import { resolvePersonaForRole } from '../lib/rolePersonas.js';
import { useRoleTheme } from '../lib/RoleThemeContext.js';
import type {
  BusinessProblemDto,
  CommandCenterDto,
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
    // Keeps any already-loaded dashboard visible while refetching (a role
    // switch is a search-param change, which re-runs this exact effect) —
    // resetting to `null` here would unmount AppShell itself on every
    // switch, replacing the whole shell (sidebar included) with a bare
    // LoadingScreen and destroying the signature role-transition entirely.
    setState((current) => ({ ...current, loading: true, error: null }));
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

/**
 * Composes the deterministic "Nexora Brief" from real widget + problem
 * data. Exported for focused unit tests of the attention-failure branch.
 */
export function composeBrief(
  organizationName: string,
  center: CommandCenterDto | null,
  problems: readonly BusinessProblemDto[] | null,
  attentionFailed: boolean,
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

  if (attentionFailed) {
    // The attention/problems request failed — the rest of the command
    // center is real and current, but we must NOT claim "nothing needs
    // your attention" from data we never received.
    return `${organizationName}: the rest of your command center is current, but attention items could not be loaded — retry them below.${workflowNote}`;
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
  // The attention/problems request is SECONDARY: its failure must never
  // take down the whole page, but it must also never render as a silent
  // "nothing needs attention". This flag drives an inline, retryable
  // failure state in the attention section (and suppresses the brief's
  // "operating normally" claim) without touching the primary center.
  const [attentionFailed, setAttentionFailed] = useState(false);
  // Cross-fades the content on role/workspace switch instead of a loading
  // screen — set true just before a NON-initial refetch, cleared once the
  // new center has painted.
  const [morphing, setMorphing] = useState(false);
  const firstLoadRef = useRef(true);
  const { theme } = useRoleTheme();

  // Loads the SECONDARY context (role-context + detected problems). Never
  // rejects: role-context failure falls back to the center's own role
  // fields (still real data, never blank); a problems failure is surfaced
  // through `attentionFailed` so it reads as "couldn't load", not "clear".
  const loadSecondary = useCallback(async () => {
    const scope = `organizationId=${encodeURIComponent(organizationId)}&workspaceId=${encodeURIComponent(workspaceId)}`;
    const [context, problemList] = await Promise.all([
      api<RoleContextResponse>(`/role-context?${scope}`).then(
        (value) => ({ ok: true as const, value }),
        () => ({ ok: false as const }),
      ),
      fetchProblems({ organizationId, workspaceId }).then(
        (value) => ({ ok: true as const, value }),
        () => ({ ok: false as const }),
      ),
    ]);
    if (context.ok) {
      setRoleContext(context.value);
    }
    if (problemList.ok) {
      setProblems(problemList.value);
      setAttentionFailed(false);
    } else {
      setProblems(null);
      setAttentionFailed(true);
    }
  }, [organizationId, workspaceId]);

  const load = useCallback(async () => {
    if (!firstLoadRef.current) {
      setMorphing(true);
    }
    setError(null);
    try {
      const scope = `organizationId=${encodeURIComponent(organizationId)}&workspaceId=${encodeURIComponent(workspaceId)}`;
      // Only the command-center fetch can fail the page; `loadSecondary`
      // absorbs its own errors into `attentionFailed`.
      const [center] = await Promise.all([
        api<CommandCenterDto>(`/command-center?${scope}`),
        loadSecondary(),
      ]);
      setCenter(center);
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
  }, [organizationId, workspaceId, loadSecondary]);

  useEffect(() => {
    if (initialCenter === undefined) {
      void load();
    }
  }, [load, initialCenter]);

  const firstName = userDisplayName?.split(' ')[0];
  const currentRole = roleContext?.current;
  const persona = resolvePersonaForRole(currentRole?.roleId ?? center?.roleId);
  const roleLabel =
    persona !== undefined
      ? `${persona.displayRole} · ${persona.focusLabel}`
      : currentRole !== undefined && currentRole !== null
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

  // Fixed visual hierarchy (S44): PRIMARY health → ATTENTION → ACTIVITY →
  // SECONDARY, the same order for every role. Each role still feels
  // meaningfully different through theme.sections' labels and whichever
  // widgets the backend actually composed for it — never through a
  // per-role reshuffle of this hierarchy, which would undermine the "where
  // am I, what matters right now" consistency a first-time user needs.
  const kpiWidgets = center?.widgets.filter((w) => w.type === 'kpi') ?? [];
  const heroWidget = kpiWidgets[0];
  const secondaryKpis = kpiWidgets.slice(1);
  const signalWidgets =
    center?.widgets.filter((w) => w.type === 'list' || w.type === 'attention') ?? [];
  const activityWidgets = center?.widgets.filter((w) => w.type === 'activity') ?? [];

  return (
    <div style={{ position: 'relative' }}>
      <Stack gap={6} style={{ maxWidth: 1080, margin: '0 auto', position: 'relative', zIndex: 1 }}>
        {/* Greeting header */}
        <Stack gap={2.5}>
          <div
            style={{
              fontSize: '11px',
              fontWeight: typography.weights.semibold,
              color: 'var(--nexora-textMuted)',
              textTransform: 'uppercase',
              letterSpacing: typography.tracking.caps,
            }}
          >
            {theme.identity}
          </div>
          <Stack direction="row" gap={3} align="center" style={{ flexWrap: 'wrap' }}>
            <h1
              style={{
                fontSize: typography.sizes['4xl'],
                fontWeight: typography.weights.bold,
                letterSpacing: typography.tracking.tighter,
                lineHeight: 1.05,
              }}
            >
              {greeting()}
              {firstName !== undefined ? `, ${firstName}` : ''}.
            </h1>
            {roleLabel !== undefined ? (
              <Badge dot dotColor={theme.accent}>
                {roleLabel}
              </Badge>
            ) : null}
          </Stack>
          <p
            style={{
              fontSize: typography.sizes.md,
              color: 'var(--nexora-textSecondary)',
              maxWidth: '58ch',
            }}
          >
            {organizationName} · {theme.tagline}
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
              {/* PRIMARY BUSINESS HEALTH — the Brief (a plain, readable
                  summary card, not a decorative gradient) plus the single
                  most important number, given real visual weight. This is
                  the first thing after the header on every role. */}
              <Stack gap={3}>
                <SectionLabel>{theme.sections.health}</SectionLabel>
                <Card>
                  <Stack direction="row" gap={4} align="flex-start" style={{ flexWrap: 'wrap' }}>
                    <span
                      aria-hidden
                      style={{
                        width: 34,
                        height: 34,
                        borderRadius: 8,
                        background: theme.accentSoft,
                        display: 'inline-flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontSize: 15,
                        flexShrink: 0,
                        color: theme.accent,
                      }}
                    >
                      ✦
                    </span>
                    <Stack gap={2} style={{ flex: 1, minWidth: 240 }}>
                      <div
                        style={{
                          fontSize: typography.sizes.xs,
                          fontWeight: typography.weights.semibold,
                          color: 'var(--nexora-textMuted)',
                          textTransform: 'uppercase',
                          letterSpacing: '0.06em',
                        }}
                      >
                        {theme.briefLabel}
                      </div>
                      <p
                        style={{
                          fontSize: typography.sizes.base,
                          lineHeight: typography.lineHeights.relaxed,
                        }}
                      >
                        {composeBrief(organizationName, center, openProblems, attentionFailed)}
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
                {heroWidget !== undefined ? (
                  <CommandCenterWidget widget={heroWidget} data={center.data[heroWidget.id]} hero />
                ) : kpiWidgets.length === 0 && persona !== undefined ? (
                  <Card>
                    <EmptyState
                      icon="◎"
                      title={persona.emptyState.title}
                      description={persona.emptyState.description}
                    />
                  </Card>
                ) : null}
              </Stack>

              {/* ATTENTION REQUIRED — real detected problems, ranked by
                  severity. A failed problems request renders an inline,
                  retryable notice here instead of silently collapsing to
                  nothing (which would read as "all clear"). */}
              {attentionFailed ? (
                <Stack gap={3}>
                  <SectionLabel>{theme.sections.attention}</SectionLabel>
                  <Card>
                    <Stack
                      direction="row"
                      gap={3}
                      align="center"
                      justify="space-between"
                      style={{ flexWrap: 'wrap' }}
                    >
                      <Stack gap={0.5} style={{ minWidth: 0 }}>
                        <div
                          style={{
                            fontSize: typography.sizes.sm,
                            fontWeight: typography.weights.semibold,
                          }}
                        >
                          Attention items couldn’t be loaded
                        </div>
                        <div
                          style={{
                            fontSize: typography.sizes.xs,
                            color: 'var(--nexora-textMuted)',
                          }}
                        >
                          The rest of your command center is up to date. This section only.
                        </div>
                      </Stack>
                      <Button variant="secondary" size="sm" onClick={() => void loadSecondary()}>
                        Retry
                      </Button>
                    </Stack>
                  </Card>
                </Stack>
              ) : sortedProblems !== null && sortedProblems.length > 0 ? (
                <Stack gap={3}>
                  <SectionLabel>{theme.sections.attention}</SectionLabel>
                  <Stack gap={3}>
                    {sortedProblems.map((problem) => (
                      <ProblemAttentionCard key={problem.id} problem={problem} />
                    ))}
                  </Stack>
                </Stack>
              ) : null}

              {/* BUSINESS ACTIVITY — the timeline/activity stream */}
              {activityWidgets.length > 0 ? (
                <Stack gap={3}>
                  <SectionLabel>{theme.sections.activity}</SectionLabel>
                  <Stack gap={3}>
                    {activityWidgets.map((widget) => (
                      <CommandCenterWidget
                        key={widget.id}
                        widget={widget}
                        data={center.data[widget.id]}
                      />
                    ))}
                  </Stack>
                </Stack>
              ) : persona !== undefined ? (
                <Stack gap={3}>
                  <SectionLabel>{theme.sections.activity}</SectionLabel>
                  <Card>
                    <EmptyState
                      icon="◎"
                      title={persona.emptyState.title}
                      description={persona.emptyState.description}
                    />
                  </Card>
                </Stack>
              ) : null}

              {/* SECONDARY — supporting KPIs, signals (projects/approvals/
                  risks/workflows), the AI entry point, and quick actions.
                  Deliberately last and visually quieter than the sections
                  above: real information, not the first thing a first-time
                  user needs to read.

                  The two blocks below (kpiBlock, signalsBlock) render in an
                  order set by the persona's `secondaryEmphasis` — the ONE
                  place a role varies this page's STRUCTURE, not just its
                  labels/data. Decision-and-risk personas (CEO, CFO, HR,
                  Legal) see the numeric snapshot first; execution personas
                  (Operations, Technology) see the actionable signal list —
                  workflow failures, blocked items — first instead. Roles
                  outside the six curated personas keep the prior kpi-first
                  behavior. */}
              <Stack gap={5}>
                <SectionLabel>Secondary information</SectionLabel>

                {(() => {
                  const kpiBlock =
                    secondaryKpis.length > 0 ? (
                      <div key="kpi" className="nexora-kpi-row">
                        {secondaryKpis.map((widget) => (
                          <CommandCenterWidget
                            key={widget.id}
                            widget={widget}
                            data={center.data[widget.id]}
                          />
                        ))}
                      </div>
                    ) : null;

                  const signalsBlock =
                    signalWidgets.length > 0 ? (
                      <Stack key="signals" gap={3}>
                        <SectionLabel>{theme.sections.signals}</SectionLabel>
                        <div className="nexora-signals-grid">
                          {signalWidgets.map((widget) => (
                            <CommandCenterWidget
                              key={widget.id}
                              widget={widget}
                              data={center.data[widget.id]}
                            />
                          ))}
                        </div>
                      </Stack>
                    ) : persona !== undefined ? (
                      <Stack key="signals" gap={3}>
                        <SectionLabel>{theme.sections.signals}</SectionLabel>
                        <Card>
                          <EmptyState
                            icon="◎"
                            title={persona.emptyState.title}
                            description={persona.emptyState.description}
                          />
                        </Card>
                      </Stack>
                    ) : null;

                  return persona?.secondaryEmphasis === 'signals-first'
                    ? [signalsBlock, kpiBlock]
                    : [kpiBlock, signalsBlock];
                })()}

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
                        &ldquo;{theme.briefQuestion}&rdquo;
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
                        <Link
                          to="/app/problems"
                          style={{ textDecoration: 'none', color: 'inherit' }}
                        >
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
              </Stack>
            </Stack>
          </div>
        )}
      </Stack>

      <style>{`
        .nexora-quick-action:hover { background: var(--nexora-surfaceMuted); }
        .nexora-kpi-row {
          display: grid;
          /* auto-fill (not auto-fit): a single secondary KPI stays a compact
             card in its own track rather than stretching wide. */
          grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
          gap: 12px;
        }
        .nexora-signals-grid {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 16px;
        }
        @media (max-width: 900px) {
          .nexora-signals-grid { grid-template-columns: 1fr; }
        }
        @media (max-width: 560px) {
          .nexora-kpi-row { grid-template-columns: repeat(2, minmax(0, 1fr)); }
        }
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
            {humanizeProblemTitle(problem.title)}
          </span>
        </Stack>
        <p style={{ fontSize: typography.sizes.sm, color: 'var(--nexora-textSecondary)' }}>
          {humanizeProblemText(problem.description)}
        </p>
        {problem.recommendation !== undefined ? (
          <p style={{ fontSize: typography.sizes.sm, color: 'var(--nexora-text)' }}>
            <strong>Nexora recommends:</strong>{' '}
            {humanizeRecommendationSummary(problem.recommendation.summary)}
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
