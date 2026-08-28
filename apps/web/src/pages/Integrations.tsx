/**
 * @nexora/app-web — Integrations page (S20).
 *
 * The Integrations application view (V1-9: webhooks out, email
 * notifications, inbound email actions): a workspace webhook registry with
 * creation (event subscription), enable/disable, and deletion; per-endpoint
 * delivery receipts (the append-only audit trail of the webhook-out
 * surface); and the email outbox (the persisted record of every email
 * notification dispatched). Loading, empty, and error states mirror the
 * other application views; the full signing secret is shown EXACTLY once —
 * at creation.
 */

import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Badge, Button, Card, EmptyState, Input, Stack, typography } from '@nexora/design-system';

import { AppShell } from '../components/AppShell.js';
import { ErrorState } from '../components/ErrorState.js';
import { LoadingScreen } from '../components/LoadingScreen.js';
import { api, ApiError } from '../lib/api.js';
import type {
  DashboardResponse,
  EmailOutboxDto,
  WebhookCreatedResponse,
  WebhookDeliveryDto,
  WebhookEndpointDto,
  WebhookRegistryResponse,
} from '../lib/types.js';
import { useSession } from '../session.js';

/** The integrations application page. */
export function Integrations(): JSX.Element {
  const { data: session } = useSession();
  const [searchParams] = useSearchParams();

  const [state, setState] = useState<{
    dashboard: DashboardResponse | null;
    loading: boolean;
    error: ApiError | null;
  }>({ dashboard: null, loading: true, error: null });

  const load = useCallback(async () => {
    // Keeps any already-loaded dashboard visible while refetching — a role
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
            icon="🔌"
            title="Create a workspace first"
            description="Integrations live inside a workspace. Set one up to get started."
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
      <IntegrationsView
        organizationId={dashboard.organization.id}
        workspaceId={dashboard.workspace.id}
        organizationName={dashboard.organization.name}
      />
    </AppShell>
  );
}

/** Props of {@link IntegrationsView}. */
export interface IntegrationsViewProps {
  /** The current organization id (the trusted integration scope). */
  organizationId: string;
  /** The current workspace id (the trusted integration scope). */
  workspaceId: string;
  /** The current organization name. */
  organizationName: string;
}

/** The pure integrations content (exported for smoke tests). */
export function IntegrationsView({
  organizationId,
  workspaceId,
  organizationName,
}: IntegrationsViewProps): JSX.Element {
  const [registry, setRegistry] = useState<WebhookRegistryResponse>({
    endpoints: [],
    subscribableEvents: [],
  });
  const [deliveriesByEndpoint, setDeliveriesByEndpoint] = useState<
    Record<string, readonly WebhookDeliveryDto[]>
  >({});
  const [emails, setEmails] = useState<readonly EmailOutboxDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<ApiError | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const scope = `organizationId=${encodeURIComponent(organizationId)}&workspaceId=${encodeURIComponent(workspaceId)}`;
      const [registryResponse, outbox] = await Promise.all([
        api<WebhookRegistryResponse>(`/integrations/webhooks?${scope}`),
        api<{ emails: EmailOutboxDto[] }>(`/integrations/email/outbox?${scope}`),
      ]);
      setRegistry(registryResponse);
      setEmails(outbox.emails);
    } catch (caught) {
      setError(
        caught instanceof ApiError ? caught : new ApiError(0, 'INTERNAL_ERROR', 'Request failed'),
      );
    } finally {
      setLoading(false);
    }
  }, [organizationId, workspaceId]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleEndpointChanged = useCallback(async () => {
    await load();
  }, [load]);

  const handleDeliveries = useCallback(
    async (endpointId: string) => {
      const scope = `organizationId=${encodeURIComponent(organizationId)}&workspaceId=${encodeURIComponent(workspaceId)}`;
      try {
        const response = await api<{ deliveries: WebhookDeliveryDto[] }>(
          `/integrations/webhooks/${endpointId}/deliveries?${scope}`,
        );
        setDeliveriesByEndpoint((current) => ({ ...current, [endpointId]: response.deliveries }));
      } catch (caught) {
        setError(
          caught instanceof ApiError
            ? caught
            : new ApiError(0, 'INTERNAL_ERROR', 'Failed to load deliveries'),
        );
      }
    },
    [organizationId, workspaceId],
  );

  return (
    <Stack gap={8} style={{ maxWidth: 960, margin: '0 auto' }}>
      <Stack direction="row" gap={4} align="center" justify="space-between">
        <Stack gap={1}>
          <h1 style={{ fontSize: typography.sizes['2xl'], fontWeight: typography.weights.bold }}>
            Integrations
          </h1>
          <p style={{ fontSize: typography.sizes.sm, color: 'var(--nexora-textSecondary)' }}>
            {organizationName} · webhooks, email, and inbound actions
          </p>
        </Stack>
        <Badge tone="primary" dot>
          {registry.endpoints.length} {registry.endpoints.length === 1 ? 'webhook' : 'webhooks'}
        </Badge>
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
          <EmptyState icon="🔌" title="Loading integrations…" description="Please wait." />
        </Card>
      ) : (
        <Stack gap={6}>
          <WebhookCreator
            organizationId={organizationId}
            workspaceId={workspaceId}
            subscribableEvents={registry.subscribableEvents}
            onCreated={() => void handleEndpointChanged()}
          />

          <Stack gap={3}>
            <h2 style={{ fontSize: typography.sizes.lg, fontWeight: typography.weights.semibold }}>
              Webhook endpoints
            </h2>
            {registry.endpoints.length === 0 ? (
              <Card>
                <EmptyState
                  icon="🔗"
                  title="No webhooks yet"
                  description="Create an endpoint to receive signed payloads when business events fire."
                />
              </Card>
            ) : (
              registry.endpoints.map((endpoint) => (
                <WebhookRow
                  key={endpoint.id}
                  endpoint={endpoint}
                  deliveries={deliveriesByEndpoint[endpoint.id] ?? []}
                  organizationId={organizationId}
                  workspaceId={workspaceId}
                  onChanged={() => void handleEndpointChanged()}
                  onDeliveries={() => void handleDeliveries(endpoint.id)}
                />
              ))
            )}
          </Stack>

          <Stack gap={3}>
            <h2 style={{ fontSize: typography.sizes.lg, fontWeight: typography.weights.semibold }}>
              Email outbox
            </h2>
            {emails.length === 0 ? (
              <Card>
                <EmptyState
                  icon="✉️"
                  title="No emails dispatched yet"
                  description="Email notifications are sent to the actor of business events (dev sink — no SMTP required)."
                />
              </Card>
            ) : (
              <Stack gap={3}>
                {emails.map((email) => (
                  <Card key={email.id} style={{ padding: '14px 16px' }}>
                    <Stack gap={2}>
                      <Stack direction="row" gap={4} align="center" justify="space-between">
                        <div style={{ fontWeight: typography.weights.semibold }}>
                          {email.subject}
                        </div>
                        <span
                          style={{
                            fontSize: typography.sizes.xs,
                            color: 'var(--nexora-textMuted)',
                          }}
                        >
                          {new Date(email.dispatchedAt).toLocaleString()}
                        </span>
                      </Stack>
                      <div
                        style={{ fontSize: typography.sizes.xs, color: 'var(--nexora-textMuted)' }}
                      >
                        to {email.recipientEmail} · event {email.sourceEventId}
                      </div>
                      <div
                        style={{
                          fontSize: typography.sizes.sm,
                          color: 'var(--nexora-textSecondary)',
                          whiteSpace: 'pre-wrap',
                        }}
                      >
                        {email.body}
                      </div>
                    </Stack>
                  </Card>
                ))}
              </Stack>
            )}
          </Stack>
        </Stack>
      )}
    </Stack>
  );
}

/** Creates a webhook endpoint (URL + event-type subscription). */
function WebhookCreator({
  organizationId,
  workspaceId,
  subscribableEvents,
  onCreated,
}: {
  organizationId: string;
  workspaceId: string;
  subscribableEvents: readonly string[];
  onCreated: () => void;
}): JSX.Element {
  const [url, setUrl] = useState('');
  const [selected, setSelected] = useState<readonly string[]>([]);
  const [creating, setCreating] = useState(false);
  const [createdSecret, setCreatedSecret] = useState<string | null>(null);
  const [error, setError] = useState<ApiError | null>(null);

  const toggle = useCallback((eventType: string) => {
    setSelected((current) =>
      current.includes(eventType)
        ? current.filter((type) => type !== eventType)
        : [...current, eventType],
    );
  }, []);

  const handleCreate = useCallback(async () => {
    setCreating(true);
    setError(null);
    setCreatedSecret(null);
    try {
      const created = await api<WebhookCreatedResponse>('/integrations/webhooks', {
        method: 'POST',
        body: JSON.stringify({ organizationId, workspaceId, url, eventTypes: [...selected] }),
      });
      setCreatedSecret(created.secret);
      setUrl('');
      setSelected([]);
      onCreated();
    } catch (caught) {
      setError(
        caught instanceof ApiError ? caught : new ApiError(0, 'INTERNAL_ERROR', 'Create failed'),
      );
    } finally {
      setCreating(false);
    }
  }, [organizationId, workspaceId, url, selected, onCreated]);

  return (
    <Card>
      <Stack gap={3}>
        <div style={{ fontWeight: typography.weights.semibold }}>Create a webhook endpoint</div>
        <Input
          id="integrations-webhook-url"
          name="webhookUrl"
          aria-label="Webhook URL"
          placeholder="https://example.com/hooks/nexora"
          value={url}
          onChange={(event) => setUrl(event.currentTarget.value)}
        />
        <Stack gap={2}>
          <div style={{ fontSize: typography.sizes.sm, color: 'var(--nexora-textSecondary)' }}>
            Subscribe to events:
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {subscribableEvents.map((eventType) => {
              const active = selected.includes(eventType);
              return (
                <button
                  key={eventType}
                  type="button"
                  aria-pressed={active}
                  onClick={() => toggle(eventType)}
                  style={{
                    border: '1px solid var(--nexora-border)',
                    background: active ? 'var(--nexora-primarySoft)' : 'var(--nexora-surface)',
                    color: active ? 'var(--nexora-primary)' : 'var(--nexora-textSecondary)',
                    borderRadius: 999,
                    padding: '5px 10px',
                    fontSize: typography.sizes.xs,
                    fontWeight: active ? typography.weights.medium : typography.weights.regular,
                    cursor: 'pointer',
                  }}
                >
                  {eventType}
                </button>
              );
            })}
          </div>
        </Stack>
        <Stack direction="row" gap={3} align="center" justify="space-between">
          <Button
            size="sm"
            onClick={() => void handleCreate()}
            disabled={creating || url.trim().length === 0 || selected.length === 0}
            loading={creating}
          >
            {creating ? 'Creating…' : 'Create endpoint'}
          </Button>
        </Stack>
        {createdSecret !== null ? (
          <Card style={{ background: 'var(--nexora-surfaceMuted)' }}>
            <div style={{ fontSize: typography.sizes.sm, fontWeight: typography.weights.semibold }}>
              Signing secret (shown once)
            </div>
            <div style={{ fontSize: typography.sizes.xs, color: 'var(--nexora-textMuted)' }}>
              Verify payloads with{' '}
              <code>x-nexora-signature: sha256=hmac(&lt;secret&gt;, body)</code>
            </div>
            <code
              id="integrations-webhook-secret"
              style={{ fontSize: typography.sizes.sm, wordBreak: 'break-all' }}
            >
              {createdSecret}
            </code>
          </Card>
        ) : null}
        {error !== null ? (
          <div style={{ fontSize: typography.sizes.sm, color: 'var(--nexora-danger)' }}>
            {error.message}
          </div>
        ) : null}
      </Stack>
    </Card>
  );
}

/** A single webhook endpoint row with enable/disable, deliveries, delete. */
function WebhookRow({
  endpoint,
  deliveries,
  organizationId,
  workspaceId,
  onChanged,
  onDeliveries,
}: {
  endpoint: WebhookEndpointDto;
  deliveries: readonly WebhookDeliveryDto[];
  organizationId: string;
  workspaceId: string;
  onChanged: () => void;
  onDeliveries: () => void;
}): JSX.Element {
  const [busy, setBusy] = useState(false);
  const [showDeliveries, setShowDeliveries] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);

  const handleToggle = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      await api(`/integrations/webhooks/${endpoint.id}/enable`, {
        method: 'POST',
        body: JSON.stringify({
          organizationId,
          workspaceId,
          enabled: !endpoint.enabled,
        }),
      });
      onChanged();
    } catch (caught) {
      setError(
        caught instanceof ApiError ? caught : new ApiError(0, 'INTERNAL_ERROR', 'Toggle failed'),
      );
    } finally {
      setBusy(false);
    }
  }, [endpoint.id, endpoint.enabled, organizationId, workspaceId, onChanged]);

  const handleDelete = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      await api(`/integrations/webhooks/${endpoint.id}`, {
        method: 'DELETE',
        body: JSON.stringify({ organizationId, workspaceId }),
      });
      onChanged();
    } catch (caught) {
      setError(
        caught instanceof ApiError ? caught : new ApiError(0, 'INTERNAL_ERROR', 'Delete failed'),
      );
    } finally {
      setBusy(false);
    }
  }, [endpoint.id, organizationId, workspaceId, onChanged]);

  return (
    <Card style={{ padding: '14px 16px' }}>
      <Stack gap={3}>
        <Stack
          direction="row"
          gap={3}
          align="center"
          justify="space-between"
          style={{ flexWrap: 'wrap' }}
        >
          <Stack gap={0.5} style={{ minWidth: 0 }}>
            <div style={{ fontWeight: typography.weights.semibold, wordBreak: 'break-all' }}>
              {endpoint.url}
            </div>
            <Stack direction="row" gap={3} align="center">
              {endpoint.enabled ? (
                <Badge tone="success" dot>
                  Enabled
                </Badge>
              ) : (
                <Badge>Disabled</Badge>
              )}
              <span style={{ fontSize: typography.sizes.xs, color: 'var(--nexora-textMuted)' }}>
                {endpoint.secretMasked}
              </span>
            </Stack>
            {error !== null ? (
              <div style={{ fontSize: typography.sizes.xs, color: 'var(--nexora-danger)' }}>
                {error.message}
              </div>
            ) : null}
          </Stack>
          <Stack direction="row" gap={3} align="center">
            <Button size="sm" variant="ghost" onClick={() => void handleToggle()} disabled={busy}>
              {endpoint.enabled ? 'Disable' : 'Enable'}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => void handleDelete()} disabled={busy}>
              Delete
            </Button>
          </Stack>
        </Stack>

        <Stack direction="row" gap={2} style={{ flexWrap: 'wrap' }}>
          {endpoint.eventTypes.map((eventType) => (
            <span
              key={eventType}
              style={{
                border: '1px solid var(--nexora-border)',
                borderRadius: 999,
                padding: '3px 8px',
                fontSize: typography.sizes.xs,
                color: 'var(--nexora-textSecondary)',
              }}
            >
              {eventType}
            </span>
          ))}
        </Stack>

        <Button
          size="sm"
          variant="ghost"
          onClick={() => {
            if (!showDeliveries) {
              onDeliveries();
            }
            setShowDeliveries((open) => !open);
          }}
        >
          {showDeliveries ? 'Hide deliveries' : 'Show delivery receipts'}
        </Button>
        {showDeliveries ? (
          <Stack gap={2}>
            {deliveries.length === 0 ? (
              <div style={{ fontSize: typography.sizes.sm, color: 'var(--nexora-textMuted)' }}>
                No deliveries yet — receipts appear when subscribed events fire.
              </div>
            ) : (
              deliveries.map((delivery) => (
                <Stack
                  key={delivery.id}
                  direction="row"
                  gap={3}
                  align="center"
                  justify="space-between"
                  style={{
                    border: '1px solid var(--nexora-border)',
                    borderRadius: 8,
                    padding: '8px 10px',
                  }}
                >
                  <Stack gap={1}>
                    <div style={{ fontSize: typography.sizes.sm }}>{delivery.eventType}</div>
                    <div
                      style={{ fontSize: typography.sizes.xs, color: 'var(--nexora-textMuted)' }}
                    >
                      {delivery.eventId} · attempt {delivery.attempt} ·{' '}
                      {new Date(delivery.deliveredAt).toLocaleString()}
                    </div>
                  </Stack>
                  {delivery.status === 'delivered' ? (
                    <Badge tone="success">HTTP {delivery.statusCode}</Badge>
                  ) : (
                    <Badge>{delivery.error ?? 'failed'}</Badge>
                  )}
                </Stack>
              ))
            )}
          </Stack>
        ) : null}
      </Stack>
    </Card>
  );
}
