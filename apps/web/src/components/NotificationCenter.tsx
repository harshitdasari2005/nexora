/**
 * @nexora/app-web — Notification Center.
 *
 * The notification surface of the Nexora shell (Notification + Activity Feed
 * vertical slice; FRONTEND.md §10): a bell with the unread count, a dropdown
 * inbox (read/unread, priority, mark-read, read-all), a real-time SSE stream
 * so the count and list update live, and per-category preference toggles.
 *
 * Security contract (server-enforced): the recipient is always the
 * authenticated user — this component never sends a `userId`; the tenant and
 * workspace scope come from the trusted membership read models resolved by
 * the API from the authenticated session.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Badge, Spinner, Stack, typography } from '@nexora/design-system';

import { api, ApiError } from '../lib/api.js';
import type { NotificationDto, NotificationPreferencesDto } from '../lib/types.js';

/** Props of {@link NotificationCenter}. */
export interface NotificationCenterProps {
  /** The current organization id (tenant scope for the API query). */
  organizationId?: string;
  /** The current workspace id (workspace scope for the API query). */
  workspaceId?: string;
}

/** The category labels shown in the preferences panel. */
const CATEGORY_LABELS: Record<string, string> = {
  workflow: 'Workflow',
  approval: 'Approvals',
  project: 'Projects',
  employee: 'Employees',
  document: 'Documents',
  knowledge: 'Knowledge',
  system: 'System',
};

/** Priority → badge tone mapping. */
const PRIORITY_TONE: Record<string, 'neutral' | 'warning' | 'danger'> = {
  low: 'neutral',
  normal: 'neutral',
  high: 'warning',
  urgent: 'danger',
};

/** Builds the scoped query string for the notification endpoints. */
function scopeQuery(organizationId?: string, workspaceId?: string): string {
  const params = new URLSearchParams();
  if (organizationId !== undefined) params.set('organizationId', organizationId);
  if (workspaceId !== undefined) params.set('workspaceId', workspaceId);
  const suffix = params.toString();
  return suffix.length > 0 ? `?${suffix}` : '';
}

/** Formats an ISO timestamp as a short relative time. */
function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  const diff = Math.max(0, Date.now() - then);
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return 'now';
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  return `${days}d`;
}

/** The notification bell + dropdown inbox. */
export function NotificationCenter({
  organizationId,
  workspaceId,
}: NotificationCenterProps): JSX.Element {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [preferencesOpen, setPreferencesOpen] = useState(false);
  const [notifications, setNotifications] = useState<NotificationDto[]>([]);
  const [preferences, setPreferences] = useState<NotificationPreferencesDto | null>(null);
  const [unread, setUnread] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);

  const scope = scopeQuery(organizationId, workspaceId);

  const refresh = useCallback(async () => {
    try {
      const [listed, count] = await Promise.all([
        api<{ notifications: NotificationDto[] }>(`/notifications${scope}`),
        api<{ count: number }>(`/notifications/unread-count${scope}`),
      ]);
      setNotifications(listed.notifications);
      setUnread(count.count);
      setError(null);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Could not load notifications');
    } finally {
      setLoading(false);
    }
  }, [scope]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Live updates: one authenticated SSE connection per open app shell.
  // The server filters every event to the authenticated recipient, so the
  // stream can never deliver another user's notifications.
  useEffect(() => {
    const source = new EventSource(`/api/notifications/stream${scope}`);
    source.addEventListener('notification', () => {
      void refresh();
    });
    source.addEventListener('activity', () => {
      void refresh();
    });
    return () => source.close();
  }, [scope, refresh]);

  // Close on outside click.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent): void => {
      if (panelRef.current !== null && !panelRef.current.contains(event.target as Node)) {
        setOpen(false);
        setPreferencesOpen(false);
      }
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [open]);

  const markRead = useCallback(
    async (notification: NotificationDto) => {
      if (notification.status === 'read') {
        handleAction(notification);
        return;
      }
      try {
        await api(`/notifications/${notification.id}/read`);
        setNotifications((current) =>
          current.map((n) => (n.id === notification.id ? { ...n, status: 'read' as const } : n)),
        );
        setUnread((count) => Math.max(0, count - 1));
        handleAction(notification);
      } catch {
        // Read-state updates are best-effort; the list refresh reconciles.
      }
    },
    [navigate],
  );

  const markAllRead = useCallback(async () => {
    try {
      await api(`/notifications/read-all${scope}`);
      setNotifications((current) => current.map((n) => ({ ...n, status: 'read' as const })));
      setUnread(0);
    } catch {
      // Best-effort.
    }
  }, [scope]);

  /** Navigates to an actionable notification's in-app destination. */
  function handleAction(notification: NotificationDto): void {
    setOpen(false);
    if (notification.action !== undefined) {
      navigate(notification.action.href);
    }
  }

  const toggleCategory = useCallback(
    async (category: string, enabled: boolean) => {
      if (preferences === null) return;
      try {
        const updated = await api<{ preferences: NotificationPreferencesDto }>(
          `/notifications/preferences${scope}`,
          {
            method: 'PUT',
            body: JSON.stringify({ category, enabled }),
          },
        );
        setPreferences(updated.preferences);
      } catch {
        // Preferences are presentation-only; failure leaves state unchanged.
      }
    },
    [preferences, scope],
  );

  const loadPreferences = useCallback(async () => {
    try {
      const result = await api<{ preferences: NotificationPreferencesDto }>(
        `/notifications/preferences${scope}`,
      );
      setPreferences(result.preferences);
    } catch {
      // Preferences are optional; the inbox still works without them.
    }
  }, [scope]);

  return (
    <div ref={panelRef} style={{ position: 'relative' }}>
      {/* Bell + unread badge */}
      <button
        type="button"
        aria-label={unread > 0 ? `Notifications (${unread} unread)` : 'Notifications'}
        onClick={() => {
          setOpen((current) => !current);
          if (!open) void refresh();
        }}
        style={{
          position: 'relative',
          width: 36,
          height: 36,
          borderRadius: 10,
          border: '1px solid var(--nexora-border)',
          background: 'var(--nexora-surfaceMuted)',
          cursor: 'pointer',
          fontSize: 15,
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        🔔
        {unread > 0 ? (
          <span
            style={{
              position: 'absolute',
              top: -5,
              right: -5,
              minWidth: 17,
              height: 17,
              paddingInline: 4,
              borderRadius: 9,
              background: 'var(--nexora-danger)',
              color: '#fff',
              fontSize: 10,
              fontWeight: 700,
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            {unread > 99 ? '99+' : unread}
          </span>
        ) : null}
      </button>

      {/* Dropdown panel */}
      {open ? (
        <div
          style={{
            position: 'absolute',
            top: 44,
            right: 0,
            width: 380,
            maxHeight: '70vh',
            display: 'flex',
            flexDirection: 'column',
            background: 'var(--nexora-surface)',
            border: '1px solid var(--nexora-borderStrong)',
            borderRadius: 14,
            boxShadow: '0 12px 40px rgba(0,0,0,0.16)',
            overflow: 'hidden',
            zIndex: 40,
          }}
        >
          {/* Header */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '12px 16px',
              borderBottom: '1px solid var(--nexora-border)',
            }}
          >
            <Stack gap={2} direction="row" align="center">
              <span
                style={{ fontWeight: typography.weights.semibold, fontSize: typography.sizes.base }}
              >
                Notifications
              </span>
              {unread > 0 ? (
                <Badge tone="danger" dot>
                  {unread} unread
                </Badge>
              ) : null}
            </Stack>
            <Stack gap={2} direction="row" align="center">
              <button
                type="button"
                onClick={() => {
                  setPreferencesOpen((current) => !current);
                  if (!preferencesOpen) void loadPreferences();
                }}
                style={linkButtonStyle}
              >
                Preferences
              </button>
              {unread > 0 ? (
                <button type="button" onClick={() => void markAllRead()} style={linkButtonStyle}>
                  Mark all read
                </button>
              ) : null}
            </Stack>
          </div>

          {/* Preferences panel */}
          {preferencesOpen && preferences !== null ? (
            <div
              style={{
                padding: '12px 16px',
                borderBottom: '1px solid var(--nexora-border)',
                background: 'var(--nexora-surfaceMuted)',
              }}
            >
              <div
                style={{
                  fontSize: typography.sizes.xs,
                  color: 'var(--nexora-textMuted)',
                  marginBottom: 8,
                }}
              >
                Delivery preferences — disables presentation only, never the underlying business
                action.
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                {Object.entries(preferences.categories).map(([category, enabled]) => (
                  <label
                    key={category}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                      fontSize: typography.sizes.sm,
                      cursor: 'pointer',
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={enabled}
                      onChange={(event) => void toggleCategory(category, event.target.checked)}
                    />
                    {CATEGORY_LABELS[category] ?? category}
                  </label>
                ))}
              </div>
            </div>
          ) : null}

          {/* List */}
          <div style={{ overflowY: 'auto', flex: 1 }}>
            {loading ? (
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'center',
                  padding: 28,
                }}
              >
                <Spinner />
              </div>
            ) : error !== null ? (
              <div style={{ padding: 20, textAlign: 'center' }}>
                <div style={{ fontSize: typography.sizes.sm }}>{error}</div>
                <button type="button" onClick={() => void refresh()} style={linkButtonStyle}>
                  Retry
                </button>
              </div>
            ) : notifications.length === 0 ? (
              <div style={{ padding: 28, textAlign: 'center' }}>
                <div style={{ fontSize: 26, marginBottom: 8 }}>🔕</div>
                <div
                  style={{ fontSize: typography.sizes.sm, fontWeight: typography.weights.medium }}
                >
                  You're all caught up
                </div>
                <div
                  style={{
                    fontSize: typography.sizes.xs,
                    color: 'var(--nexora-textMuted)',
                    marginTop: 4,
                  }}
                >
                  Approvals, workflow results, and workspace events appear here.
                </div>
              </div>
            ) : (
              notifications.map((notification) => (
                <button
                  key={notification.id}
                  type="button"
                  onClick={() => void markRead(notification)}
                  style={{
                    display: 'block',
                    width: '100%',
                    textAlign: 'left',
                    padding: '12px 16px',
                    border: 'none',
                    borderBottom: '1px solid var(--nexora-border)',
                    background:
                      notification.status === 'unread'
                        ? 'var(--nexora-primarySoft)'
                        : 'transparent',
                    cursor: 'pointer',
                  }}
                >
                  <Stack gap={1}>
                    <Stack direction="row" gap={2} align="center">
                      {notification.status === 'unread' ? (
                        <span
                          aria-hidden
                          style={{
                            width: 7,
                            height: 7,
                            borderRadius: 4,
                            background: 'var(--nexora-primary)',
                          }}
                        />
                      ) : null}
                      <span
                        style={{
                          fontSize: typography.sizes.sm,
                          fontWeight:
                            notification.status === 'unread'
                              ? typography.weights.semibold
                              : typography.weights.medium,
                        }}
                      >
                        {notification.title}
                      </span>
                      <span
                        style={{
                          marginLeft: 'auto',
                          fontSize: typography.sizes.xs,
                          color: 'var(--nexora-textMuted)',
                        }}
                      >
                        {relativeTime(notification.createdAt)}
                      </span>
                    </Stack>
                    <div
                      style={{
                        fontSize: typography.sizes.xs,
                        color: 'var(--nexora-textSecondary)',
                        lineHeight: 1.4,
                      }}
                    >
                      {notification.body}
                    </div>
                    <Stack direction="row" gap={2} align="center">
                      <Badge tone={PRIORITY_TONE[notification.priority] ?? 'neutral'}>
                        {notification.priority}
                      </Badge>
                      <span
                        style={{ fontSize: typography.sizes.xs, color: 'var(--nexora-textMuted)' }}
                      >
                        {notification.type}
                      </span>
                      {notification.action !== undefined ? (
                        <span
                          style={{
                            marginLeft: 'auto',
                            fontSize: typography.sizes.xs,
                            color: 'var(--nexora-primary)',
                          }}
                        >
                          {notification.action.label} →
                        </span>
                      ) : null}
                    </Stack>
                  </Stack>
                </button>
              ))
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}

const linkButtonStyle: React.CSSProperties = {
  border: 'none',
  background: 'transparent',
  color: 'var(--nexora-primary)',
  fontSize: typography.sizes.xs,
  cursor: 'pointer',
  padding: 0,
  textDecoration: 'underline',
};
