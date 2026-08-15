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
}

/** Renders one widget through the widget-type → renderer registry. */
export function CommandCenterWidget({ widget, data }: CommandCenterWidgetProps): JSX.Element {
  return (
    <Card
      padding={5}
      style={{
        gridColumn: widget.span === 2 ? 'span 2' : 'span 1',
        minWidth: 0,
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <Stack gap={1} style={{ marginBottom: 12 }}>
        <h2 style={{ fontSize: typography.sizes.md, fontWeight: typography.weights.semibold }}>
          {widget.title}
        </h2>
        {widget.description !== undefined ? (
          <p style={{ fontSize: typography.sizes.xs, color: 'var(--nexora-textMuted)' }}>
            {widget.description}
          </p>
        ) : null}
      </Stack>
      {data === undefined ? <EmptyState title="No data" /> : renderWidgetData(widget.type, data)}
    </Card>
  );
}

/** The widget-type → renderer mapping (one renderer per type, shared by all roles). */
function renderWidgetData(
  type: CommandCenterWidgetDto['type'],
  data: CommandCenterWidgetDataDto,
): JSX.Element {
  switch (type) {
    case 'kpi':
      return <KpiWidget data={data} />;
    case 'activity':
      return <ActivityWidget data={data} />;
    case 'attention':
      return <AttentionWidget data={data} />;
    case 'list':
      return <ListWidget data={data} />;
  }
}

/** Renders a KPI metric. */
function KpiWidget({ data }: { data: CommandCenterWidgetDataDto }): JSX.Element {
  if (data.kind !== 'kpi') {
    return <EmptyState title="No metric" />;
  }
  return (
    <Stack gap={0.5}>
      <div style={{ fontSize: typography.sizes['3xl'], fontWeight: typography.weights.bold }}>
        {data.value}
      </div>
      {data.hint !== undefined ? (
        <div style={{ fontSize: typography.sizes.xs, color: 'var(--nexora-textMuted)' }}>
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
  const tone = entry.priority === 'urgent' || entry.priority === 'high' ? 'warning' : undefined;
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
        >
          {entry.title}
        </div>
        {entry.subtitle !== undefined ? (
          <div style={{ fontSize: typography.sizes.xs, color: 'var(--nexora-textMuted)' }}>
            {entry.subtitle}
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
