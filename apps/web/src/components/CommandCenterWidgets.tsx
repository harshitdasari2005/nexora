/**
 * @nexora/app-web — Command Center widget renderers (S24 Phase 2).
 *
 * The GENERIC widget renderer registry: widget TYPE → renderer. There is one
 * renderer per widget type, shared by every role — the role determines which
 * widgets are composed (the CommandCenterDefinition), never which renderer
 * is used. No `CEOKpiWidget`, `ManagerKpiWidget`, or `DeveloperKpiWidget`
 * exists: the same KPI renderer draws every role's KPI.
 */

import { Link } from 'react-router-dom';
import { Badge, Card, EmptyState, Stack, typography } from '@nexora/design-system';

import { humanizeIdentifiersInText } from '../lib/humanize.js';
import type {
  CommandCenterEntryDto,
  CommandCenterWidgetDataDto,
  CommandCenterWidgetDto,
} from '../lib/types.js';

/** A rendered widget: the definition (title/layout) + its resolved data. */
export interface CommandCenterWidgetProps {
  /** The widget definition. */
  widget: CommandCenterWidgetDto;
  /** The widget's resolved data (missing data renders an empty state). */
  data?: CommandCenterWidgetDataDto;
  /**
   * Gives the widget hero visual weight (the single most important number,
   * not a grid of identical cards). Only meaningful on `kpi` widgets.
   */
  hero?: boolean;
}

/** Renders one widget through the widget-type → renderer registry. */
export function CommandCenterWidget({
  widget,
  data,
  hero = false,
}: CommandCenterWidgetProps): JSX.Element {
  const isHeroKpi = hero && widget.type === 'kpi';
  return (
    <Card
      padding={5}
      interactive
      style={{
        gridColumn: widget.span === 2 || isHeroKpi ? 'span 2' : 'span 1',
        minWidth: 0,
        display: 'flex',
        flexDirection: 'column',
        ...(isHeroKpi ? { borderColor: 'var(--nexora-borderStrong)' } : null),
      }}
    >
      <Stack gap={1} style={{ marginBottom: widget.type === 'kpi' ? 12 : 14 }}>
        <h2
          style={
            widget.type === 'kpi'
              ? {
                  fontSize: '11px',
                  fontWeight: typography.weights.semibold,
                  textTransform: 'uppercase',
                  letterSpacing: '0.06em',
                  color: 'var(--nexora-textMuted)',
                }
              : {
                  fontSize: typography.sizes.md,
                  fontWeight: typography.weights.semibold,
                  letterSpacing: '-0.01em',
                }
          }
        >
          {widget.title}
        </h2>
        {widget.description !== undefined ? (
          <p style={{ fontSize: typography.sizes.xs, color: 'var(--nexora-textMuted)' }}>
            {widget.description}
          </p>
        ) : null}
      </Stack>
      {data === undefined ? (
        <EmptyState title="No data" />
      ) : (
        renderWidgetData(widget.type, data, isHeroKpi)
      )}
    </Card>
  );
}

/** The widget-type → renderer mapping (one renderer per type, shared by all roles). */
function renderWidgetData(
  type: CommandCenterWidgetDto['type'],
  data: CommandCenterWidgetDataDto,
  hero = false,
): JSX.Element {
  switch (type) {
    case 'kpi':
      return <KpiWidget data={data} hero={hero} />;
    case 'activity':
      return <ActivityWidget data={data} />;
    case 'attention':
      return <AttentionWidget data={data} />;
    case 'list':
      return <ListWidget data={data} />;
  }
}

/** Maps a KPI tone to its display color (falls back to the default text color). */
function kpiToneColor(tone: 'neutral' | 'success' | 'warning' | 'danger' | undefined): string {
  if (tone === 'success') return 'var(--nexora-success)';
  if (tone === 'warning') return 'var(--nexora-warning)';
  if (tone === 'danger') return 'var(--nexora-danger)';
  return 'var(--nexora-text)';
}

/** Renders a KPI metric — hero KPIs render noticeably larger. */
function KpiWidget({
  data,
  hero = false,
}: {
  data: CommandCenterWidgetDataDto;
  hero?: boolean;
}): JSX.Element {
  if (data.kind !== 'kpi') {
    return <EmptyState title="No metric" />;
  }
  return (
    <Stack gap={hero ? 1.5 : 1}>
      <div
        className="nexora-kpi-value"
        style={{
          fontSize: hero ? typography.sizes['5xl'] : typography.sizes['4xl'],
          fontWeight: typography.weights.semibold,
          lineHeight: 1,
          letterSpacing: '-0.035em',
          color: kpiToneColor(data.tone),
          fontVariantNumeric: 'tabular-nums',
        }}
      >
        {data.value}
      </div>
      {data.hint !== undefined ? (
        <div
          style={{
            fontSize: hero ? typography.sizes.sm : typography.sizes.xs,
            color: 'var(--nexora-textMuted)',
          }}
        >
          {data.hint}
        </div>
      ) : null}
    </Stack>
  );
}

/** Renders a list of entries (e.g. projects, documents, workflow health). */
function ListWidget({ data }: { data: CommandCenterWidgetDataDto }): JSX.Element {
  if (data.kind !== 'list') {
    return <EmptyState title="No data" />;
  }
  if (data.items.length === 0) {
    return (
      <EmptyState icon="▤" title="Nothing here yet" description="Data appears as it accumulates." />
    );
  }
  return (
    <Stack gap={2}>
      {data.items.map((item) => (
        <EntryRow key={item.id} entry={item} />
      ))}
    </Stack>
  );
}

/** Renders the recent activity feed. */
function ActivityWidget({ data }: { data: CommandCenterWidgetDataDto }): JSX.Element {
  if (data.kind !== 'activity') {
    return <EmptyState title="No activity" />;
  }
  if (data.items.length === 0) {
    return (
      <EmptyState
        icon="⚡"
        title="No activity yet"
        description="Business activity appears here as it happens."
      />
    );
  }
  return (
    <Stack gap={2}>
      {data.items.map((item) => (
        <div
          key={item.id}
          style={{
            borderLeft: '2px solid var(--nexora-borderStrong)',
            paddingLeft: 12,
            minWidth: 0,
          }}
        >
          <div style={{ fontSize: typography.sizes.sm, fontWeight: typography.weights.medium }}>
            {item.title}
          </div>
          {item.body !== undefined ? (
            <div style={{ fontSize: typography.sizes.xs, color: 'var(--nexora-textSecondary)' }}>
              {item.body}
            </div>
          ) : null}
          {item.occurredAt !== undefined ? (
            <div style={{ fontSize: typography.sizes.xs, color: 'var(--nexora-textMuted)' }}>
              {new Date(item.occurredAt).toLocaleString()}
            </div>
          ) : null}
        </div>
      ))}
    </Stack>
  );
}

/** Renders the attention (unread notification) queue. */
function AttentionWidget({ data }: { data: CommandCenterWidgetDataDto }): JSX.Element {
  if (data.kind !== 'attention') {
    return <EmptyState title="No attention items" />;
  }
  if (data.items.length === 0) {
    return (
      <EmptyState
        icon="✓"
        title="You're all caught up"
        description="Unread notifications appear here."
      />
    );
  }
  return (
    <Stack gap={2}>
      {data.items.map((item) => (
        <EntryRow key={item.id} entry={item} attention />
      ))}
    </Stack>
  );
}

/** One entry row of a list/attention widget. */
function EntryRow({
  entry,
  attention = false,
}: {
  entry: CommandCenterEntryDto;
  attention?: boolean;
}): JSX.Element {
  const successRate = parseSuccessRate(entry.status);
  const tone =
    successRate !== undefined
      ? successRateTone(successRate)
      : entry.priority === 'urgent' || entry.priority === 'high'
        ? 'warning'
        : undefined;
  const content = (
    <Stack
      direction="row"
      gap={3}
      align="center"
      justify="space-between"
      style={{
        border: '1px solid var(--nexora-border)',
        borderRadius: 10,
        padding: '9px 12px',
        minWidth: 0,
        ...(attention ? { background: 'var(--nexora-surfaceMuted)' } : null),
      }}
    >
      <Stack gap={0.5} style={{ minWidth: 0 }}>
        <div
          style={{
            fontWeight: typography.weights.medium,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
          title={entry.title}
        >
          {humanizeIdentifiersInText(entry.title)}
        </div>
        {entry.subtitle !== undefined ? (
          <div style={{ fontSize: typography.sizes.xs, color: 'var(--nexora-textMuted)' }}>
            {humanizeIdentifiersInText(entry.subtitle)}
          </div>
        ) : null}
        {entry.body !== undefined ? (
          <div style={{ fontSize: typography.sizes.xs, color: 'var(--nexora-textSecondary)' }}>
            {entry.body}
          </div>
        ) : null}
      </Stack>
      {entry.status !== undefined ? <Badge tone={tone}>{entry.status}</Badge> : null}
    </Stack>
  );
  return entry.href !== undefined ? (
    <Link to={entry.href} style={{ textDecoration: 'none', color: 'inherit' }}>
      {content}
    </Link>
  ) : (
    content
  );
}

/** Extracts a success-rate percentage from an entry status like "25% success". */
function parseSuccessRate(status: string | undefined): number | undefined {
  if (status === undefined) return undefined;
  const match = /^(\d+(?:\.\d+)?)%\s*success$/i.exec(status.trim());
  if (match?.[1] === undefined) return undefined;
  const value = Number(match[1]);
  return Number.isFinite(value) ? value : undefined;
}

/** Colors a workflow success rate by severity — low rates read as danger, never neutral. */
function successRateTone(rate: number): 'success' | 'warning' | 'danger' {
  if (rate < 50) return 'danger';
  if (rate < 90) return 'warning';
  return 'success';
}
