/**
 * @nexora/app-web — Agents page (agent identity management).
 *
 * Lists the workspace's agent identities and, for the selected one, shows
 * its delegations (with the server-derived `expired` status) and effective
 * capabilities. Managers can create an agent, suspend / reactivate / revoke
 * it (revoked is terminal), and grant / revoke capability delegations.
 *
 * The server decides authority: bodies carry only the action's own fields
 * (never user/owner/organization/workspace), every refusal is shown with the
 * server's message, and nothing is reported as done until the API confirms.
 * Delegating never bypasses approvals — a delegation only lets the agent
 * attempt what YOU could do yourself, and writes still go through approval.
 */

import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  Field,
  Input,
  Select,
  Stack,
  typography,
} from '@nexora/design-system';

import { AppShell } from '../components/AppShell.js';
import { ErrorState } from '../components/ErrorState.js';
import { LoadingScreen } from '../components/LoadingScreen.js';
import { api, ApiError } from '../lib/api.js';
import {
  createAgent,
  grantDelegation,
  inspectAgent,
  listAgents,
  revokeDelegation,
  setAgentStatus,
  type AgentAuthorityDto,
  type AgentDelegationDto,
  type AgentDelegationEffectiveStatus,
  type AgentIdentityDto,
  type AgentIdentityStatus,
} from '../lib/agents.js';
import type { DashboardResponse } from '../lib/types.js';
import { useSession } from '../session.js';

const AGENT_STATUS_TONE: Record<AgentIdentityStatus, 'success' | 'warning' | 'danger'> = {
  active: 'success',
  suspended: 'warning',
  revoked: 'danger',
};

const DELEGATION_STATUS_TONE: Record<
  AgentDelegationEffectiveStatus,
  'success' | 'warning' | 'danger'
> = { active: 'success', expired: 'warning', revoked: 'danger' };

/** The delegation notice (approvals are never bypassed). */
export const DELEGATION_NOTICE =
  'Delegating never bypasses approvals; you can only delegate what you can do yourself.';

/** The Agents application page (loads shell context). */
export function Agents(): JSX.Element {
  const { data: session } = useSession();
  const [searchParams] = useSearchParams();

  const [state, setState] = useState<{
    dashboard: DashboardResponse | null;
    loading: boolean;
    error: ApiError | null;
  }>({ dashboard: null, loading: true, error: null });

  const load = useCallback(async () => {
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
            icon="✦"
            title="Create a workspace first"
            description="Agents are bound to a workspace. Set one up to manage them."
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
      <AgentsView
        organizationId={dashboard.organization.id}
        workspaceId={dashboard.workspace.id}
        workspaceName={dashboard.workspace.name}
      />
    </AppShell>
  );
}

/** Props of {@link AgentsView}. */
export interface AgentsViewProps {
  organizationId: string;
  workspaceId: string;
  workspaceName: string;
  /** Optional preloaded agents (server-rendered smoke tests). */
  initialAgents?: readonly AgentIdentityDto[];
  /** Optional preselected agent id (smoke tests). */
  initialSelectedId?: string;
  /** Optional preloaded authority of the selected agent (smoke tests). */
  initialAuthority?: AgentAuthorityDto;
}

function errorMessage(caught: unknown, fallback: string): string {
  return caught instanceof ApiError ? caught.message : fallback;
}

function formatWhen(iso: string | undefined): string {
  if (iso === undefined) return '—';
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : date.toISOString().slice(0, 16).replace('T', ' ');
}

/** The pure agents content (exported for smoke tests). */
export function AgentsView({
  organizationId,
  workspaceId,
  workspaceName,
  initialAgents,
  initialSelectedId,
  initialAuthority,
}: AgentsViewProps): JSX.Element {
  const scope = { organizationId, workspaceId };
  const [agents, setAgents] = useState<readonly AgentIdentityDto[] | null>(initialAgents ?? null);
  const [selectedId, setSelectedId] = useState<string | null>(initialSelectedId ?? null);
  const [authority, setAuthority] = useState<AgentAuthorityDto | null>(initialAuthority ?? null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmRevoke, setConfirmRevoke] = useState(false);

  const refresh = useCallback(
    async (agentId: string | null) => {
      try {
        setAgents(await listAgents(scope));
        if (agentId !== null) {
          setAuthority(await inspectAgent(scope, agentId));
        }
      } catch (caught) {
        setError(errorMessage(caught, 'Could not load agents'));
      }
    },
    [organizationId, workspaceId],
  );

  useEffect(() => {
    if (initialAgents === undefined) {
      void refresh(null);
    }
  }, [refresh, initialAgents]);

  const select = useCallback(
    async (agentId: string) => {
      setSelectedId(agentId);
      setAuthority(null);
      setConfirmRevoke(false);
      setError(null);
      try {
        setAuthority(await inspectAgent(scope, agentId));
      } catch (caught) {
        setError(errorMessage(caught, 'Could not load the agent'));
      }
    },
    [organizationId, workspaceId],
  );

  /** Runs one mutation; shows the server's message on refusal, then reloads. */
  const act = useCallback(
    async (fn: () => Promise<unknown>, agentId: string | null, fallback: string) => {
      setBusy(true);
      setError(null);
      try {
        await fn();
        setConfirmRevoke(false);
        await refresh(agentId);
        return true;
      } catch (caught) {
        setError(errorMessage(caught, fallback));
        return false;
      } finally {
        setBusy(false);
      }
    },
    [refresh],
  );

  const selected = agents?.find((agent) => agent.id === selectedId) ?? authority?.agent ?? null;
  const status = selected?.status;

  return (
    <Stack gap={6} style={{ maxWidth: 1080, margin: '0 auto' }}>
      <Stack gap={1}>
        <h1 className="nexora-page-title">Agents</h1>
        <p style={{ fontSize: typography.sizes.sm, color: 'var(--nexora-textSecondary)' }}>
          Agent identities of {workspaceName}, and the capabilities delegated to them.
        </p>
      </Stack>

      <Card padding={4}>
        <p role="note" style={{ fontSize: typography.sizes.sm }}>
          {DELEGATION_NOTICE}
        </p>
      </Card>

      {error !== null ? (
        <Card>
          <div
            role="alert"
            style={{ fontSize: typography.sizes.sm, color: 'var(--nexora-danger)' }}
          >
            {error}
          </div>
        </Card>
      ) : null}

      <CreateAgentForm
        busy={busy}
        onCreate={async (input) => {
          let createdId: string | null = null;
          const ok = await act(
            async () => {
              createdId = (await createAgent(scope, input)).id;
            },
            null,
            'Could not create the agent',
          );
          if (ok && createdId !== null) void select(createdId);
          return ok;
        }}
      />

      <Card padding={5}>
        <h2 style={{ fontSize: typography.sizes.md, fontWeight: typography.weights.semibold }}>
          Workspace agents
        </h2>
        {agents === null ? (
          <p style={{ fontSize: typography.sizes.sm }}>Loading agents…</p>
        ) : agents.length === 0 ? (
          <EmptyState
            icon="✦"
            title="No agents yet"
            description="Create an agent identity to delegate capabilities to it."
          />
        ) : (
          <div className="nexora-agents-table-wrap">
            <table className="nexora-agents-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Definition</th>
                  <th>Status</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {agents.map((agent) => (
                  <tr key={agent.id} aria-selected={agent.id === selectedId}>
                    <td>{agent.name}</td>
                    <td>{agent.definitionId}</td>
                    <td>
                      <Badge tone={AGENT_STATUS_TONE[agent.status]} dot>
                        {agent.status.toUpperCase()}
                      </Badge>
                    </td>
                    <td>
                      <Button
                        size="sm"
                        variant={agent.id === selectedId ? 'primary' : 'secondary'}
                        onClick={() => void select(agent.id)}
                      >
                        {agent.id === selectedId ? 'Selected' : 'Inspect'}
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {selected !== null && status !== undefined ? (
        <Card padding={5}>
          <Stack gap={4}>
            <Stack direction="row" gap={2} align="center" style={{ flexWrap: 'wrap' }}>
              <h2
                style={{ fontSize: typography.sizes.lg, fontWeight: typography.weights.semibold }}
              >
                {selected.name}
              </h2>
              <Badge tone={AGENT_STATUS_TONE[status]} dot>
                {status.toUpperCase()}
              </Badge>
            </Stack>
            {selected.statusReason !== undefined ? (
              <p style={{ fontSize: typography.sizes.xs, color: 'var(--nexora-textMuted)' }}>
                Reason: {selected.statusReason}
              </p>
            ) : null}
            <Stack direction="row" gap={2} style={{ flexWrap: 'wrap' }}>
              <Button
                size="sm"
                variant="secondary"
                disabled={busy || status !== 'active'}
                onClick={() =>
                  void act(
                    () => setAgentStatus(scope, selected.id, 'suspend'),
                    selected.id,
                    'Could not suspend the agent',
                  )
                }
              >
                Suspend
              </Button>
              <Button
                size="sm"
                variant="secondary"
                disabled={busy || status !== 'suspended'}
                onClick={() =>
                  void act(
                    () => setAgentStatus(scope, selected.id, 'reactivate'),
                    selected.id,
                    'Could not reactivate the agent',
                  )
                }
              >
                Reactivate
              </Button>
              {confirmRevoke ? (
                <>
                  <span style={{ fontSize: typography.sizes.sm, alignSelf: 'center' }}>
                    Revoking is permanent. Revoke {selected.name}?
                  </span>
                  <Button
                    size="sm"
                    variant="danger"
                    disabled={busy || status === 'revoked'}
                    onClick={() =>
                      void act(
                        () => setAgentStatus(scope, selected.id, 'revoke'),
                        selected.id,
                        'Could not revoke the agent',
                      )
                    }
                  >
                    Confirm revoke
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setConfirmRevoke(false)}>
                    Cancel
                  </Button>
                </>
              ) : (
                <Button
                  size="sm"
                  variant="danger"
                  disabled={busy || status === 'revoked'}
                  onClick={() => setConfirmRevoke(true)}
                >
                  Revoke
                </Button>
              )}
            </Stack>

            {authority === null ? (
              <p style={{ fontSize: typography.sizes.sm }}>Loading authority…</p>
            ) : (
              <>
                <Stack gap={2}>
                  <h3
                    style={{
                      fontSize: typography.sizes.sm,
                      fontWeight: typography.weights.semibold,
                    }}
                  >
                    Effective capabilities
                  </h3>
                  {authority.effectiveCapabilityIds.length === 0 ? (
                    <p style={{ fontSize: typography.sizes.xs, color: 'var(--nexora-textMuted)' }}>
                      No effective capabilities — nothing is currently delegated.
                    </p>
                  ) : (
                    <Stack direction="row" gap={2} style={{ flexWrap: 'wrap' }}>
                      {authority.effectiveCapabilityIds.map((id) => (
                        <Badge key={id} tone="ai">
                          {id}
                        </Badge>
                      ))}
                    </Stack>
                  )}
                </Stack>

                <DelegationsTable
                  delegations={authority.delegations}
                  revokeDisabled={busy || status === 'revoked'}
                  onRevoke={(delegation) =>
                    void act(
                      () => revokeDelegation(scope, selected.id, delegation.id),
                      selected.id,
                      'Could not revoke the delegation',
                    )
                  }
                />

                <GrantForm
                  capabilityIds={authority.definitionCapabilityIds}
                  disabled={busy || status !== 'active'}
                  disabledReason={
                    status === 'active'
                      ? null
                      : `Delegations can only be granted to an active agent.`
                  }
                  onGrant={(input) =>
                    act(
                      () => grantDelegation(scope, selected.id, input),
                      selected.id,
                      'Could not grant the delegation',
                    )
                  }
                />
              </>
            )}
          </Stack>
        </Card>
      ) : null}

      <style>{`
        .nexora-agents-table-wrap { overflow-x: auto; }
        .nexora-agents-table { width: 100%; min-width: 560px; border-collapse: collapse; font-size: ${typography.sizes.sm}; }
        .nexora-agents-table thead th { text-align: left; padding: 10px 12px; font-size: ${typography.sizes.xs}; font-weight: ${typography.weights.medium}; color: var(--nexora-textMuted); border-bottom: 1px solid var(--nexora-border); white-space: nowrap; }
        .nexora-agents-table tbody td { padding: 10px 12px; border-bottom: 1px solid var(--nexora-border); }
        .nexora-agents-table tbody tr[aria-selected='true'] { background: var(--nexora-surfaceMuted); }
      `}</style>
    </Stack>
  );
}

/** The delegations table of one agent. */
function DelegationsTable({
  delegations,
  revokeDisabled,
  onRevoke,
}: {
  delegations: readonly AgentDelegationDto[];
  revokeDisabled: boolean;
  onRevoke: (delegation: AgentDelegationDto) => void;
}): JSX.Element {
  return (
    <Stack gap={2}>
      <h3 style={{ fontSize: typography.sizes.sm, fontWeight: typography.weights.semibold }}>
        Delegations
      </h3>
      {delegations.length === 0 ? (
        <p style={{ fontSize: typography.sizes.xs, color: 'var(--nexora-textMuted)' }}>
          No delegations yet.
        </p>
      ) : (
        <div className="nexora-agents-table-wrap">
          <table className="nexora-agents-table">
            <thead>
              <tr>
                <th>Capability</th>
                <th>Resource scope</th>
                <th>Granted by</th>
                <th>Expires</th>
                <th>Status</th>
                <th>Revoked</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {delegations.map((delegation) => (
                <tr key={delegation.id}>
                  <td>{delegation.capabilityId}</td>
                  <td>
                    {delegation.resourceScope === undefined
                      ? 'Whole workspace'
                      : `${delegation.resourceScope.kind}: ${delegation.resourceScope.id}`}
                  </td>
                  <td>{delegation.grantedByUserId}</td>
                  <td>{formatWhen(delegation.expiresAt)}</td>
                  <td>
                    <Badge tone={DELEGATION_STATUS_TONE[delegation.effectiveStatus]} dot>
                      {delegation.effectiveStatus}
                    </Badge>
                  </td>
                  <td>
                    {delegation.revokedAt === undefined
                      ? '—'
                      : `${formatWhen(delegation.revokedAt)}${
                          delegation.revokedBy === undefined ? '' : ` by ${delegation.revokedBy}`
                        }${
                          delegation.revokeReason === undefined
                            ? ''
                            : ` (${delegation.revokeReason})`
                        }`}
                  </td>
                  <td>
                    <Button
                      size="sm"
                      variant="secondary"
                      aria-label={`Revoke delegation ${delegation.capabilityId}`}
                      disabled={revokeDisabled || delegation.effectiveStatus !== 'active'}
                      onClick={() => onRevoke(delegation)}
                    >
                      Revoke
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Stack>
  );
}

/** Create-agent form. Resolves true when the agent was created. */
function CreateAgentForm({
  busy,
  onCreate,
}: {
  busy: boolean;
  onCreate: (input: {
    definitionId: string;
    name: string;
    description?: string;
  }) => Promise<boolean>;
}): JSX.Element {
  const [definitionId, setDefinitionId] = useState('');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const valid = definitionId.trim() !== '' && name.trim() !== '';
  return (
    <Card padding={5}>
      <Stack gap={3}>
        <h2 style={{ fontSize: typography.sizes.md, fontWeight: typography.weights.semibold }}>
          Create agent
        </h2>
        <Stack direction="row" gap={3} style={{ flexWrap: 'wrap' }}>
          <Field label="Definition id" required>
            <Input
              aria-label="Definition id"
              placeholder="e.g. finance"
              value={definitionId}
              onChange={(event) => setDefinitionId(event.target.value)}
            />
          </Field>
          <Field label="Name" required>
            <Input
              aria-label="Agent name"
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </Field>
          <Field label="Description">
            <Input
              aria-label="Agent description"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
            />
          </Field>
        </Stack>
        <div>
          <Button
            disabled={busy || !valid}
            onClick={() =>
              void onCreate({
                definitionId: definitionId.trim(),
                name: name.trim(),
                ...(description.trim() === '' ? {} : { description: description.trim() }),
              }).then((ok) => {
                if (ok) {
                  setDefinitionId('');
                  setName('');
                  setDescription('');
                }
              })
            }
          >
            Create agent
          </Button>
        </div>
      </Stack>
    </Card>
  );
}

/** Grant-delegation form (capability from the agent definition's ceiling). */
function GrantForm({
  capabilityIds,
  disabled,
  disabledReason,
  onGrant,
}: {
  capabilityIds: readonly string[];
  disabled: boolean;
  disabledReason: string | null;
  onGrant: (input: {
    capabilityId: string;
    resourceScope?: { kind: 'project' | 'budget'; id: string };
    expiresAt?: string;
  }) => Promise<boolean>;
}): JSX.Element {
  const [capabilityId, setCapabilityId] = useState('');
  const [scopeKind, setScopeKind] = useState<'' | 'project' | 'budget'>('');
  const [scopeId, setScopeId] = useState('');
  const [expiresAt, setExpiresAt] = useState('');
  const chosen = capabilityId !== '' ? capabilityId : (capabilityIds[0] ?? '');
  const scopeValid = scopeKind === '' || scopeId.trim() !== '';
  const expiryDate = expiresAt === '' ? null : new Date(expiresAt);
  const expiryValid = expiryDate === null || !Number.isNaN(expiryDate.getTime());
  return (
    <Stack gap={3}>
      <h3 style={{ fontSize: typography.sizes.sm, fontWeight: typography.weights.semibold }}>
        Grant a delegation
      </h3>
      {disabledReason !== null ? (
        <p style={{ fontSize: typography.sizes.xs, color: 'var(--nexora-textMuted)' }}>
          {disabledReason}
        </p>
      ) : null}
      <Stack direction="row" gap={3} style={{ flexWrap: 'wrap' }}>
        <Field label="Capability">
          <Select
            aria-label="Capability"
            value={chosen}
            disabled={disabled}
            onChange={(event) => setCapabilityId(event.currentTarget.value)}
          >
            {capabilityIds.map((id) => (
              <option key={id} value={id}>
                {id}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Resource scope">
          <Select
            aria-label="Resource scope kind"
            value={scopeKind}
            disabled={disabled}
            onChange={(event) =>
              setScopeKind(event.currentTarget.value as '' | 'project' | 'budget')
            }
          >
            <option value="">Whole workspace</option>
            <option value="project">Project</option>
            <option value="budget">Budget</option>
          </Select>
        </Field>
        {scopeKind !== '' ? (
          <Field label="Resource id">
            <Input
              aria-label="Resource id"
              value={scopeId}
              disabled={disabled}
              onChange={(event) => setScopeId(event.target.value)}
            />
          </Field>
        ) : null}
        <Field label="Expires (optional)">
          <Input
            aria-label="Expires at"
            type="datetime-local"
            value={expiresAt}
            disabled={disabled}
            onChange={(event) => setExpiresAt(event.target.value)}
          />
        </Field>
      </Stack>
      <div>
        <Button
          disabled={disabled || chosen === '' || !scopeValid || !expiryValid}
          onClick={() =>
            void onGrant({
              capabilityId: chosen,
              ...(scopeKind === ''
                ? {}
                : { resourceScope: { kind: scopeKind, id: scopeId.trim() } }),
              ...(expiryDate === null ? {} : { expiresAt: expiryDate.toISOString() }),
            }).then((ok) => {
              if (ok) {
                setScopeKind('');
                setScopeId('');
                setExpiresAt('');
              }
            })
          }
        >
          Grant delegation
        </Button>
      </div>
    </Stack>
  );
}
