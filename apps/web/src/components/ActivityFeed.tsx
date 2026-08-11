/**
 * @nexora/app-web — Activity Feed.
 *
 * The workspace activity surface of the Dashboard (Notification + Activity
 * Feed vertical slice). It is a pure READ MODEL: business domains remain
 * authoritative and the feed is rebuilt from the event stream by the API.
 * Filtering happens server-side — this component only renders what the
 * authenticated API returned; it never hides unauthorized activity itself.
 */

import { useCallback, useEffect, useState } from 'react';
import { Badge, Card, EmptyState, Spinner, Stack, typography } from '@nexora/design-system';

import { api, ApiError } from '../lib/api.js';
import type { ActivityItemDto } from '../lib/types.js';

/** Props of {@link ActivityFeed}. */
export interface ActivityFeedProps {
  /** The current organization id (tenant scope for the API query). */
  organizationId?: string;
  /** The current workspace id (workspace scope for the API query). */
  workspaceId?: string;
  /** Maximum number of items to load (default 20). */
  limit?: number;
}

/** The tone of an activity record (design-system semantics). */
type ActivityTone = 'neutral' | 'success' | 'danger' | 'ai';

/** Classifies an event type into a user-facing tone. */
function toneFor(type: string): ActivityTone {
  if (type.endsWith('.failed') || type.endsWith('.rejected') || type.endsWith('.cancelled')) {
    return 'danger';
  }
  if (type.endsWith('.completed') || type.endsWith('.available') || type.endsWith('.activated')) {
    return 'success';
  }
  if (type.startsWith('workflow.') || type.startsWith('approval.')) {
    return 'ai';
  }
  return 'neutral';
}

/** A short human label for an event type. */
function labelFor(type: string): string {
  return type.replace(/\./g, ' · ');
}

/** Formats an ISO timestamp for grouping/display. */
function isToday(iso: string, now: Date): boolean {
  const date = new Date(iso);
  return (
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate()
  );
}

function timeLabel(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

/** The workspace activity feed (read-only). */
export function ActivityFeed({
  organizationId,
  workspaceId,
  limit = 20,
}: ActivityFeedProps): JSX.Element {
  const [items, setItems] = useState<ActivityItemDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ limit: String(limit) });
      if (organizationId !== undefined) params.set('organizationId', organizationId);
      if (workspaceId !== undefined) params.set('workspaceId', workspaceId);
      const data = await api<{ activity: ActivityItemDto[] }>(`/activity?${params.toString()}`);
      setItems(data.activity);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Could not load activity');
    } finally {
      setLoading(false);
    }
  }, [organizationId, workspaceId, limit]);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading) {
    return (
      <Card>
        <div style={{ display: 'flex', justifyContent: 'center', padding: 24 }}>
          <Spinner />
        </div>
      </Card>
    );
  }

  if (error !== null) {
    return (
      <Card>
        <EmptyState
          icon="⚠️"
          title="Could not load activity"
          description={error}
          action={
            <button type="button" onClick={() => void load()}>
              Retry
            </button>
          }
        />
      </Card>
    );
  }

  if (items.length === 0) {
    return (
      <Card>
        <EmptyState
          icon="⚡"
          title="Nothing here yet"
          description="Project creation, hires, assignments, workflow runs, and approvals will show up here as your team gets to work."
        />
      </Card>
    );
  }

  const now = new Date();
  const today = items.filter((item) => isToday(item.occurredAt, now));
  const earlier = items.filter((item) => !isToday(item.occurredAt, now));

  const renderGroup = (group: readonly ActivityItemDto[]): JSX.Element => (
    <Stack gap={1}>
      {group.map((item) => {
        const tone = toneFor(item.type);
        return (
          <div
            key={item.id}
            style={{
              display: 'flex',
              alignItems: 'flex-start',
              gap: 12,
              padding: '10px 14px',
              borderRadius: 10,
              background: 'var(--nexora-surface)',
            }}
          >
            <span
              aria-hidden
              style={{
                width: 26,
                height: 26,
                borderRadius: 8,
                flexShrink: 0,
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 13,
                background: 'var(--nexora-surfaceMuted)',
              }}
            >
              {tone === 'danger' ? '⛔' : tone === 'success' ? '✓' : tone === 'ai' ? '✦' : '•'}
            </span>
            <Stack gap={0.5} style={{ minWidth: 0, flex: 1 }}>
              <div
                style={{
                  fontSize: typography.sizes.sm,
                  fontWeight: typography.weights.medium,
                  lineHeight: 1.35,
                }}
              >
                {item.title}
              </div>
              <div style={{ fontSize: typography.sizes.xs, color: 'var(--nexora-textSecondary)' }}>
                {item.body}
              </div>
              <Stack direction="row" gap={2} align="center">
                <Badge tone={tone}>{labelFor(item.type)}</Badge>
                <span style={{ fontSize: typography.sizes.xs, color: 'var(--nexora-textMuted)' }}>
                  {timeLabel(item.occurredAt)}
                </span>
              </Stack>
            </Stack>
          </div>
        );
      })}
    </Stack>
  );

  return (
    <Stack gap={5}>
      {today.length > 0 ? (
        <Stack gap={1}>
          <h3
            style={{
              fontSize: typography.sizes.xs,
              color: 'var(--nexora-textMuted)',
              textTransform: 'uppercase',
              letterSpacing: 1,
            }}
          >
            Today
          </h3>
          {renderGroup(today)}
        </Stack>
      ) : null}
      {earlier.length > 0 ? (
        <Stack gap={1}>
          <h3
            style={{
              fontSize: typography.sizes.xs,
              color: 'var(--nexora-textMuted)',
              textTransform: 'uppercase',
              letterSpacing: 1,
            }}
          >
            Earlier
          </h3>
          {renderGroup(earlier)}
        </Stack>
      ) : null}
    </Stack>
  );
}
