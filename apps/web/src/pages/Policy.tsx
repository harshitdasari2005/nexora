/**
 * @nexora/app-web — Policy Administration page.
 *
 * Lists every governed policy, its scope/status/version/behavior, and (for a
 * selected policy) its structured configuration, effective date and version
 * history. Configurable policies expose an enable/disable action and a
 * "create new version" form built ONLY from structured inputs (selects,
 * checkboxes, id-like text, numbers) — there is no free-form / JSON / code
 * input anywhere. Policy configuration is data, never code.
 *
 * Presentation only: the buttons are shown to anyone who can read; the SERVER
 * (`policy.manage`) answers 403/409/422 and those messages are displayed
 * verbatim. The manage form is additionally hidden when the session lacks
 * `policy.manage` — UX, not security.
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
  Skeleton,
  Stack,
  typography,
} from '@nexora/design-system';

import { AppShell } from '../components/AppShell.js';
import { NavIcon } from '../components/NavIcon.js';
import { ErrorState } from '../components/ErrorState.js';
import { LoadingScreen } from '../components/LoadingScreen.js';
import { api, ApiError } from '../lib/api.js';
import {
  BUDGET_MODES,
  POLICY_APPROVAL_AUTHORITY,
  POLICY_FINANCE_BUDGET_LIMIT,
  MAX_APPROVAL_RULES,
  createPolicyVersion,
  emptyRuleDraft,
  getPolicyHistory,
  listPolicies,
  rulesFromConfig,
  rulesToConfig,
  validateRuleDrafts,
  type BudgetMode,
  type RuleDraft,
} from '../lib/policy.js';
import { useRoleTheme } from '../lib/RoleThemeContext.js';
import type {
  DashboardResponse,
  PolicyAdminDto,
  PolicyVersionDto,
  PolicyVersionRequest,
} from '../lib/types.js';
import { useSession } from '../session.js';

const toError = (error: unknown): ApiError =>
  error instanceof ApiError ? error : new ApiError(0, 'INTERNAL_ERROR', 'Request failed');

/** Formats an ISO timestamp. */
function formatWhen(iso: string | undefined): string {
  if (iso === undefined) return '—';
  return new Date(iso).toLocaleString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

const short = (fingerprint: string | undefined): string =>
  fingerprint === undefined ? '—' : fingerprint.slice(0, 10);

/** The Policy Administration application page. */
/**
 * Reads the caller's permissions from the role context, which is provided BY
 * the app shell — so it must be read from inside the shell's children, not by
 * the page container above it. Presentation only: the server answers 403.
 */
function PolicyViewWithRole(
  props: Omit<Parameters<typeof PolicyView>[0], 'canManage'>,
): JSX.Element {
  const { current } = useRoleTheme();
  return (
    <PolicyView {...props} canManage={current?.permissions.includes('policy.manage') ?? false} />
  );
}

export function Policy(): JSX.Element {
  const { data: session } = useSession();
  const [searchParams] = useSearchParams();

  const [dashboard, setDashboard] = useState<DashboardResponse | null>(null);
  const [dashboardError, setDashboardError] = useState<ApiError | null>(null);
  const [policies, setPolicies] = useState<PolicyAdminDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<ApiError | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [history, setHistory] = useState<PolicyVersionDto[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const organizationId = dashboard?.organization?.id;
  const workspaceId = dashboard?.workspace?.id;

  const loadDashboard = useCallback(async () => {
    setDashboardError(null);
    try {
      const params = new URLSearchParams();
      const org = searchParams.get('organizationId');
      const ws = searchParams.get('workspaceId');
      if (org !== null) params.set('organizationId', org);
      if (ws !== null) params.set('workspaceId', ws);
      const suffix = params.size > 0 ? `?${params.toString()}` : '';
      setDashboard(await api<DashboardResponse>(`/dashboard${suffix}`));
    } catch (caught) {
      setDashboardError(toError(caught));
    }
  }, [searchParams]);

  useEffect(() => {
    void loadDashboard();
  }, [loadDashboard]);

  const loadPolicies = useCallback(async () => {
    if (organizationId === undefined || workspaceId === undefined) return;
    setLoading(true);
    setError(null);
    try {
      setPolicies(await listPolicies({ organizationId, workspaceId }));
    } catch (caught) {
      setError(toError(caught));
    } finally {
      setLoading(false);
    }
  }, [organizationId, workspaceId]);

  useEffect(() => {
    void loadPolicies();
  }, [loadPolicies]);

  const loadHistory = useCallback(
    async (policyId: string) => {
      if (organizationId === undefined || workspaceId === undefined) return;
      setHistoryLoading(true);
      setHistoryError(null);
      try {
        setHistory(await getPolicyHistory({ organizationId, workspaceId }, policyId));
      } catch (caught) {
        setHistory([]);
        setHistoryError(toError(caught).message);
      } finally {
        setHistoryLoading(false);
      }
    },
    [organizationId, workspaceId],
  );

  const select = useCallback(
    (policyId: string) => {
      setSelectedId(policyId);
      setActionError(null);
      setNotice(null);
      void loadHistory(policyId);
    },
    [loadHistory],
  );

  const submit = useCallback(
    async (body: PolicyVersionRequest) => {
      if (organizationId === undefined || workspaceId === undefined || selectedId === null) return;
      setSubmitting(true);
      setActionError(null);
      setNotice(null);
      try {
        const created = await createPolicyVersion(
          { organizationId, workspaceId },
          selectedId,
          body,
        );
        setNotice(`Saved version ${created.version}.`);
        await Promise.all([loadPolicies(), loadHistory(selectedId)]);
      } catch (caught) {
        const err = toError(caught);
        setActionError(`${err.status > 0 ? `${err.status} ` : ''}${err.message}`);
      } finally {
        setSubmitting(false);
      }
    },
    [organizationId, workspaceId, selectedId, loadPolicies, loadHistory],
  );

  if (dashboardError !== null) {
    return <ErrorState message={dashboardError.message} onRetry={() => void loadDashboard()} />;
  }
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
            icon={<NavIcon name="policy" size={18} />}
            title="Create a workspace first"
            description="Policies are scoped to a workspace. Set one up to get started."
            action={
              <Button size="lg" onClick={() => void loadDashboard()}>
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
      <PolicyViewWithRole
        organizationName={dashboard.organization.name}
        workspaceName={dashboard.workspace.name}
        policies={policies}
        loading={loading}
        error={error?.message ?? null}
        selectedId={selectedId}
        onSelect={select}
        history={history}
        historyLoading={historyLoading}
        historyError={historyError}
        submitting={submitting}
        actionError={actionError}
        notice={notice}
        onSubmit={(body) => void submit(body)}
        onRefresh={() => void loadPolicies()}
      />
    </AppShell>
  );
}

/** Props of {@link PolicyView}. */
export interface PolicyViewProps {
  organizationName: string;
  workspaceName: string;
  policies: readonly PolicyAdminDto[];
  loading: boolean;
  error: string | null;
  selectedId: string | null;
  onSelect: (policyId: string) => void;
  history: readonly PolicyVersionDto[];
  historyLoading: boolean;
  historyError: string | null;
  /** Presentation only: whether the session holds `policy.manage`. */
  canManage: boolean;
  submitting: boolean;
  /** The server's 403/409/422 text for the last submit. */
  actionError: string | null;
  notice?: string | null;
  onSubmit: (body: PolicyVersionRequest) => void;
  onRefresh: () => void;
}

/** The pure Policy Administration content (exported for tests). */
export function PolicyView({
  organizationName,
  workspaceName,
  policies,
  loading,
  error,
  selectedId,
  onSelect,
  history,
  historyLoading,
  historyError,
  canManage,
  submitting,
  actionError,
  notice = null,
  onSubmit,
  onRefresh,
}: PolicyViewProps): JSX.Element {
  const selected = policies.find((policy) => policy.policyId === selectedId) ?? null;
  return (
    <Stack gap={6} style={{ maxWidth: 1400, margin: '0 auto' }}>
      <Stack
        direction="row"
        gap={4}
        align="center"
        justify="space-between"
        style={{ flexWrap: 'wrap' }}
      >
        <Stack gap={1}>
          <h1 className="nexora-page-title">Policy Administration</h1>
          <p style={{ fontSize: typography.sizes.sm, color: 'var(--nexora-textSecondary)' }}>
            {organizationName} · {workspaceName} — governed rules and their version history
          </p>
        </Stack>
        <Button
          size="sm"
          variant="secondary"
          onClick={onRefresh}
          disabled={loading}
          loading={loading}
        >
          Refresh
        </Button>
      </Stack>

      {error !== null ? (
        <Card>
          <ErrorState message={error} onRetry={onRefresh} />
        </Card>
      ) : loading ? (
        <Card>
          <Stack gap={3}>
            <Skeleton height={18} />
            <Skeleton height={18} />
            <Skeleton height={18} />
          </Stack>
        </Card>
      ) : policies.length === 0 ? (
        <Card>
          <EmptyState
            icon={<NavIcon name="policy" size={18} />}
            title="No policies"
            description="No policies are registered for this organization."
          />
        </Card>
      ) : (
        <div className="nexora-policy-layout">
          <div className="nexora-policy-table-wrap">
            <table className="nexora-policy-table">
              <thead>
                <tr>
                  <th>Policy</th>
                  <th>Scope</th>
                  <th>Status</th>
                  <th>Version</th>
                  <th>Behavior</th>
                  <th>Approval</th>
                  <th>Last changed</th>
                </tr>
              </thead>
              <tbody>
                {policies.map((policy) => (
                  <tr
                    key={policy.policyId}
                    role="button"
                    tabIndex={0}
                    aria-label={`Policy ${policy.policyId}`}
                    className={policy.policyId === selectedId ? 'nexora-policy-row-sel' : undefined}
                    onClick={() => onSelect(policy.policyId)}
                    onKeyDown={(keyEvent) => {
                      if (keyEvent.key === 'Enter' || keyEvent.key === ' ') {
                        keyEvent.preventDefault();
                        onSelect(policy.policyId);
                      }
                    }}
                  >
                    <td>
                      <div style={{ fontWeight: typography.weights.medium }}>{policy.title}</div>
                      <div
                        style={{
                          fontSize: typography.sizes.xs,
                          fontFamily: typography.fontMono,
                          color: 'var(--nexora-textMuted)',
                        }}
                      >
                        {policy.policyId}
                      </div>
                    </td>
                    <td>{policy.scope}</td>
                    <td>
                      <Badge tone={policy.enabled ? 'success' : 'neutral'}>
                        {policy.enabled ? 'enabled' : 'disabled'}
                      </Badge>
                    </td>
                    <td>{policy.currentVersion ?? `rule ${policy.ruleVersion}`}</td>
                    <td>{policy.behavior}</td>
                    <td>{approvalSummary(policy)}</td>
                    <td>
                      {formatWhen(policy.effectiveAt)}
                      <div
                        style={{ fontSize: typography.sizes.xs, color: 'var(--nexora-textMuted)' }}
                      >
                        {policy.updatedByName ?? policy.updatedBy ?? '—'}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="nexora-policy-detail">
            {selected === null ? (
              <Card>
                <EmptyState
                  icon={<NavIcon name="policy" size={18} />}
                  title="Select a policy"
                  description="Choose a policy to see its rules and version history."
                />
              </Card>
            ) : (
              <PolicyDetail
                policy={selected}
                history={history}
                historyLoading={historyLoading}
                historyError={historyError}
                canManage={canManage}
                submitting={submitting}
                actionError={actionError}
                notice={notice}
                onSubmit={onSubmit}
              />
            )}
          </div>
        </div>
      )}
      <style>{`
        .nexora-policy-layout { display: grid; grid-template-columns: minmax(0, 1.4fr) minmax(320px, 1fr); gap: 16px; align-items: start; }
        @media (max-width: 1100px) { .nexora-policy-layout { grid-template-columns: 1fr; } }
        .nexora-policy-table-wrap { overflow-x: auto; }
        .nexora-policy-table, .nexora-policy-history { width: 100%; border-collapse: collapse; font-size: ${typography.sizes.sm}; }
        .nexora-policy-table thead th, .nexora-policy-history thead th {
          text-align: left; padding: 8px 10px; font-weight: ${typography.weights.medium};
          font-size: ${typography.sizes.xs}; color: var(--nexora-textMuted);
          border-bottom: 1px solid var(--nexora-border);
        }
        .nexora-policy-table tbody td, .nexora-policy-history tbody td {
          padding: 10px; border-bottom: 1px solid var(--nexora-border); vertical-align: top;
        }
        .nexora-policy-table tbody tr { cursor: pointer; background: var(--nexora-surface); }
        .nexora-policy-table tbody tr:hover { background: var(--nexora-surfaceMuted); }
        .nexora-policy-row-sel { background: var(--nexora-surfaceMuted) !important; }
      `}</style>
    </Stack>
  );
}

function approvalSummary(policy: PolicyAdminDto): string {
  if (policy.approval === undefined) {
    return policy.behavior === 'REQUIRE_APPROVAL' ? 'Approval required' : '—';
  }
  const roles = policy.approval.requiredApproverRoleIds;
  return [
    'Approval required',
    roles.length > 0 ? `approver: ${roles.join(', ')}` : null,
    policy.approval.separationOfDuties ? 'separation of duties' : null,
  ]
    .filter((part): part is string => part !== null)
    .join(' · ');
}

const humanKey = (key: string): string =>
  key
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .replace(/^./, (c) => c.toUpperCase());

/** Renders a config value as labeled, escaped fields (never raw JSON). */
export function ConfigFields({
  value,
  depth = 0,
}: {
  value: Record<string, unknown>;
  depth?: number;
}): JSX.Element {
  const entries = Object.entries(value);
  if (entries.length === 0) {
    return <span style={{ color: 'var(--nexora-textMuted)' }}>No configuration</span>;
  }
  return (
    <dl style={{ margin: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
      {entries.map(([key, item]) => (
        <div key={key}>
          <dt style={{ fontSize: typography.sizes.xs, color: 'var(--nexora-textMuted)' }}>
            {humanKey(key)}
          </dt>
          <dd style={{ margin: 0, fontSize: typography.sizes.sm }}>
            {renderConfigValue(item, depth)}
          </dd>
        </div>
      ))}
    </dl>
  );
}

function renderConfigValue(item: unknown, depth: number): JSX.Element {
  if (Array.isArray(item)) {
    if (item.length === 0) return <span>None</span>;
    return (
      <Stack gap={2}>
        {item.map((entry, index) => (
          <div
            key={index}
            style={{
              borderLeft: '2px solid var(--nexora-border)',
              paddingLeft: 10,
            }}
          >
            {renderConfigValue(entry, depth + 1)}
          </div>
        ))}
      </Stack>
    );
  }
  if (typeof item === 'object' && item !== null) {
    if (depth >= 4) return <span>…</span>;
    return <ConfigFields value={item as Record<string, unknown>} depth={depth + 1} />;
  }
  if (typeof item === 'boolean') return <span>{item ? 'Yes' : 'No'}</span>;
  return <span>{String(item)}</span>;
}

interface PolicyDetailProps {
  policy: PolicyAdminDto;
  history: readonly PolicyVersionDto[];
  historyLoading: boolean;
  historyError: string | null;
  canManage: boolean;
  submitting: boolean;
  actionError: string | null;
  notice: string | null;
  onSubmit: (body: PolicyVersionRequest) => void;
}

function PolicyDetail({
  policy,
  history,
  historyLoading,
  historyError,
  canManage,
  submitting,
  actionError,
  notice,
  onSubmit,
}: PolicyDetailProps): JSX.Element {
  return (
    <Stack gap={4}>
      <Card>
        <Stack gap={3}>
          <Stack direction="row" gap={2} align="center" style={{ flexWrap: 'wrap' }}>
            <h2 style={{ fontSize: typography.sizes.xl, fontWeight: typography.weights.bold }}>
              {policy.title}
            </h2>
            <Badge tone={policy.enabled ? 'success' : 'neutral'}>
              {policy.enabled ? 'enabled' : 'disabled'}
            </Badge>
            <Badge tone={policy.configurable ? 'primary' : 'neutral'}>
              {policy.configurable ? 'configurable' : 'platform-managed (read-only)'}
            </Badge>
          </Stack>
          <p style={{ fontSize: typography.sizes.sm, color: 'var(--nexora-textSecondary)' }}>
            {policy.description}
          </p>
          <dl
            style={{
              margin: 0,
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
              gap: 10,
              fontSize: typography.sizes.sm,
            }}
          >
            <DetailItem label="Policy id" value={policy.policyId} mono />
            <DetailItem label="Scope" value={policy.scope} />
            <DetailItem label="Managed by" value={policy.managedBy} />
            <DetailItem label="Current version" value={String(policy.currentVersion ?? '—')} />
            <DetailItem label="Rule version" value={String(policy.ruleVersion)} />
            <DetailItem label="Effective" value={formatWhen(policy.effectiveAt)} />
            <DetailItem
              label="Changed by"
              value={policy.updatedByName ?? policy.updatedBy ?? '—'}
            />
            <DetailItem label="Fingerprint" value={short(policy.fingerprint)} mono />
          </dl>
        </Stack>
      </Card>

      <Card>
        <Stack gap={2}>
          <div style={{ fontSize: typography.sizes.xs, color: 'var(--nexora-textMuted)' }}>
            Rules / configuration
          </div>
          {policy.config !== undefined ? (
            <ConfigFields value={policy.config} />
          ) : (
            <span style={{ fontSize: typography.sizes.sm, color: 'var(--nexora-textMuted)' }}>
              Platform default rules apply; no organization configuration.
            </span>
          )}
          {policy.approval !== undefined ? (
            <ConfigFields
              value={{
                separationOfDuties: policy.approval.separationOfDuties,
                requiredApproverRoleIds: [...policy.approval.requiredApproverRoleIds],
                ttlMinutes: policy.approval.ttlMinutes,
              }}
            />
          ) : null}
        </Stack>
      </Card>

      {policy.configurable && canManage ? (
        <PolicyChangeForm
          key={`${policy.policyId}:${policy.currentVersion ?? 0}`}
          policy={policy}
          submitting={submitting}
          onSubmit={onSubmit}
        />
      ) : null}
      {policy.configurable && !canManage ? (
        <div style={{ fontSize: typography.sizes.xs, color: 'var(--nexora-textMuted)' }}>
          Your current role cannot change policies.
        </div>
      ) : null}
      {actionError !== null ? (
        <div
          role="alert"
          style={{
            padding: '10px 14px',
            background: 'var(--nexora-dangerSoft)',
            border: '1px solid var(--nexora-danger)',
            borderRadius: 8,
            fontSize: typography.sizes.sm,
            color: 'var(--nexora-danger)',
          }}
        >
          {actionError}
        </div>
      ) : null}
      {notice !== null ? (
        <div
          role="status"
          style={{ fontSize: typography.sizes.sm, color: 'var(--nexora-success)' }}
        >
          {notice}
        </div>
      ) : null}

      <Card>
        <Stack gap={2}>
          <div style={{ fontSize: typography.sizes.xs, color: 'var(--nexora-textMuted)' }}>
            Version history
          </div>
          {historyLoading ? (
            <Skeleton height={18} />
          ) : historyError !== null ? (
            <div role="alert" style={{ color: 'var(--nexora-danger)' }}>
              {historyError}
            </div>
          ) : history.length === 0 ? (
            <span style={{ fontSize: typography.sizes.sm, color: 'var(--nexora-textMuted)' }}>
              No versions recorded.
            </span>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table className="nexora-policy-history">
                <thead>
                  <tr>
                    <th>Version</th>
                    <th>Change</th>
                    <th>Enabled</th>
                    <th>Reason</th>
                    <th>Created by</th>
                    <th>Created</th>
                    <th>Fingerprint</th>
                  </tr>
                </thead>
                <tbody>
                  {history.map((version) => (
                    <tr key={version.version}>
                      <td>{version.version}</td>
                      <td>{version.changeType}</td>
                      <td>{version.enabled ? 'Yes' : 'No'}</td>
                      <td>{version.reason ?? '—'}</td>
                      <td>{version.createdBy}</td>
                      <td>{formatWhen(version.createdAt)}</td>
                      <td style={{ fontFamily: typography.fontMono }}>
                        {short(version.fingerprint)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Stack>
      </Card>
    </Stack>
  );
}

function DetailItem({
  label,
  value,
  mono = false,
}: {
  label: string;
  value: string;
  mono?: boolean;
}): JSX.Element {
  return (
    <div>
      <dt style={{ fontSize: typography.sizes.xs, color: 'var(--nexora-textMuted)' }}>{label}</dt>
      <dd
        style={{
          margin: 0,
          overflowWrap: 'anywhere',
          fontFamily: mono ? typography.fontMono : undefined,
        }}
      >
        {value}
      </dd>
    </div>
  );
}

interface PolicyChangeFormProps {
  policy: PolicyAdminDto;
  submitting: boolean;
  onSubmit: (body: PolicyVersionRequest) => void;
}

/**
 * Structured change form. Inputs are allow-listed by policy id: a mode select
 * for the budget limit; an approval-rule list (id-like text, checkbox, number)
 * for approval authority. No JSON/code field exists.
 */
export function PolicyChangeForm({
  policy,
  submitting,
  onSubmit,
}: PolicyChangeFormProps): JSX.Element {
  const isBudget = policy.policyId === POLICY_FINANCE_BUDGET_LIMIT;
  const isAuthority = policy.policyId === POLICY_APPROVAL_AUTHORITY;
  const initialMode = policy.config?.['mode'];
  const [mode, setMode] = useState<BudgetMode>(
    BUDGET_MODES.find((m) => m === initialMode) ?? 'require_approval',
  );
  const [rules, setRules] = useState<RuleDraft[]>(() => rulesFromConfig(policy.config));
  const [reason, setReason] = useState('');
  const [localError, setLocalError] = useState<string | null>(null);

  const base = (): PolicyVersionRequest => ({
    ...(reason.trim() !== '' ? { reason: reason.trim() } : {}),
    ...(policy.currentVersion !== undefined ? { expectedVersion: policy.currentVersion } : {}),
  });

  const updateRule = (index: number, patch: Partial<RuleDraft>): void =>
    setRules((current) => current.map((rule, i) => (i === index ? { ...rule, ...patch } : rule)));

  const createVersion = (): void => {
    if (isAuthority) {
      const problem = validateRuleDrafts(rules);
      if (problem !== null) {
        setLocalError(problem);
        return;
      }
    }
    setLocalError(null);
    onSubmit({
      ...base(),
      config: isBudget ? { mode } : rulesToConfig(rules),
      enabled: policy.enabled,
    });
  };

  const toggle = (): void => {
    setLocalError(null);
    onSubmit({ ...base(), enabled: !policy.enabled });
  };

  return (
    <Card>
      <Stack gap={3}>
        <div style={{ fontSize: typography.sizes.xs, color: 'var(--nexora-textMuted)' }}>
          Change policy (creates a new version; history is never rewritten)
        </div>

        {isBudget ? (
          <Field label="Over-budget behavior" hint="Configuration may only tighten the policy.">
            <Select
              aria-label="Budget limit mode"
              value={mode}
              onChange={(event) => setMode(event.currentTarget.value as BudgetMode)}
            >
              <option value="require_approval">Require approval</option>
              <option value="deny">Deny</option>
            </Select>
          </Field>
        ) : null}

        {isAuthority ? (
          <Stack gap={3}>
            {rules.map((rule, index) => (
              <div
                key={index}
                role="group"
                aria-label={`Approval rule ${index + 1}`}
                style={{
                  border: '1px solid var(--nexora-border)',
                  borderRadius: 8,
                  padding: 12,
                }}
              >
                <Stack gap={2}>
                  <Field label="Capability prefix" hint="Id-like, e.g. finance. or hr.hire">
                    <Input
                      aria-label={`Capability prefix ${index + 1}`}
                      value={rule.capabilityPrefix}
                      maxLength={64}
                      onChange={(event) =>
                        updateRule(index, { capabilityPrefix: event.currentTarget.value })
                      }
                    />
                  </Field>
                  <label
                    style={{
                      display: 'flex',
                      gap: 8,
                      alignItems: 'center',
                      fontSize: typography.sizes.sm,
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={rule.separationOfDuties}
                      onChange={(event) =>
                        updateRule(index, { separationOfDuties: event.currentTarget.checked })
                      }
                    />
                    Separation of duties (requester cannot approve)
                  </label>
                  <Field label="Required approver role id" hint="Optional, e.g. finance.cfo">
                    <Input
                      aria-label={`Required approver role ${index + 1}`}
                      value={rule.requiredApproverRoleId}
                      maxLength={64}
                      onChange={(event) =>
                        updateRule(index, { requiredApproverRoleId: event.currentTarget.value })
                      }
                    />
                  </Field>
                  <Field label="TTL (minutes)" hint="Optional, 1 to 10080">
                    <Input
                      aria-label={`TTL minutes ${index + 1}`}
                      type="number"
                      min={1}
                      max={10080}
                      step={1}
                      value={rule.ttlMinutes}
                      onChange={(event) =>
                        updateRule(index, { ttlMinutes: event.currentTarget.value })
                      }
                    />
                  </Field>
                  <div>
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => setRules((current) => current.filter((_, i) => i !== index))}
                    >
                      Remove rule
                    </Button>
                  </div>
                </Stack>
              </div>
            ))}
            <div>
              <Button
                size="sm"
                variant="secondary"
                disabled={rules.length >= MAX_APPROVAL_RULES}
                onClick={() => setRules((current) => [...current, emptyRuleDraft()])}
              >
                Add rule
              </Button>
            </div>
          </Stack>
        ) : null}

        <Field label="Reason" hint="Recorded in the version history (max 500 characters).">
          <Input
            aria-label="Reason for change"
            value={reason}
            maxLength={500}
            onChange={(event) => setReason(event.currentTarget.value)}
          />
        </Field>

        {localError !== null ? (
          <div role="alert" style={{ color: 'var(--nexora-danger)', fontSize: 13 }}>
            {localError}
          </div>
        ) : null}

        <Stack direction="row" gap={2} style={{ flexWrap: 'wrap' }}>
          <Button size="sm" onClick={createVersion} disabled={submitting} loading={submitting}>
            Create new version
          </Button>
          <Button size="sm" variant="secondary" onClick={toggle} disabled={submitting}>
            {policy.enabled ? 'Disable policy' : 'Enable policy'}
          </Button>
        </Stack>
      </Stack>
    </Card>
  );
}
