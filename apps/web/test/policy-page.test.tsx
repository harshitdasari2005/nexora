/**
 * Server-render tests for the Policy Administration and Approvals pages, the
 * approval card's governance rows, and the Runtime page's expired state.
 */

import { describe, expect, it } from 'vitest';
import { renderToString } from 'react-dom/server';

import { ApprovalsView } from '../src/pages/Approvals.js';
import { PolicyChangeForm, PolicyView, type PolicyViewProps } from '../src/pages/Policy.js';
import { RuntimeView, MetricsStrip } from '../src/pages/Runtime.js';
import { ApprovalCard } from '../src/components/AiPanel.js';
import {
  rulesToConfig,
  validateRuleDrafts,
  relativeTo,
  emptyRuleDraft,
} from '../src/lib/policy.js';
import { isModuleVisible } from '../src/lib/modules.js';
import type {
  ApprovalGovernanceDto,
  PolicyAdminDto,
  PolicyVersionDto,
  RuntimeMetricsDto,
  RuntimeRunDto,
} from '../src/lib/types.js';

const budget: PolicyAdminDto = {
  policyId: 'POLICY_FINANCE_BUDGET_LIMIT',
  title: 'Budget limit',
  description: 'Over-budget expenses',
  scope: 'organization',
  configurable: true,
  managedBy: 'organization',
  ruleVersion: 1,
  currentVersion: 3,
  enabled: true,
  config: { mode: 'deny' },
  effectiveAt: '2026-08-20T10:00:00.000Z',
  updatedBy: 'usr_ceo',
  updatedByName: 'Casey CEO',
  fingerprint: 'abcdef0123456789abcdef',
  behavior: 'CONFIGURABLE',
};
const authority: PolicyAdminDto = {
  ...budget,
  policyId: 'POLICY_APPROVAL_AUTHORITY',
  title: 'Approval authority',
  currentVersion: 1,
  config: { rules: [{ capabilityPrefix: 'finance.', separationOfDuties: true, ttlMinutes: 60 }] },
  approval: { separationOfDuties: true, requiredApproverRoleIds: ['finance.cfo'], ttlMinutes: 60 },
};
const platform: PolicyAdminDto = {
  ...budget,
  policyId: 'POLICY_PLATFORM_ONLY',
  title: 'Platform rule',
  configurable: false,
  managedBy: 'platform',
  config: undefined,
  currentVersion: undefined,
  behavior: 'DENY',
};
const history: PolicyVersionDto[] = [
  {
    policyId: budget.policyId,
    version: 3,
    enabled: true,
    config: { mode: 'deny' },
    reason: 'tighten',
    changeType: 'version',
    createdBy: 'usr_ceo',
    createdAt: '2026-08-20T10:00:00.000Z',
    fingerprint: '0123456789abcdef',
  },
];

function props(overrides: Partial<PolicyViewProps> = {}): PolicyViewProps {
  return {
    organizationName: 'Acme',
    workspaceName: 'Legal',
    policies: [budget, authority, platform],
    loading: false,
    error: null,
    selectedId: null,
    onSelect: () => undefined,
    history: [],
    historyLoading: false,
    historyError: null,
    canManage: true,
    submitting: false,
    actionError: null,
    onSubmit: () => undefined,
    onRefresh: () => undefined,
    ...overrides,
  };
}

describe('PolicyView', () => {
  it('lists policies with status, version, behavior, approval and changed-by', () => {
    const html = renderToString(<PolicyView {...props()} />);
    for (const text of [
      'Policy Administration',
      'POLICY_FINANCE_BUDGET_LIMIT',
      'enabled',
      'CONFIGURABLE',
      'DENY',
      'organization',
      'separation of duties',
      'approver: finance.cfo',
      'Casey CEO',
    ]) {
      expect(html).toContain(text);
    }
  });

  it('shows structured detail and history, never raw JSON', () => {
    const html = renderToString(
      <PolicyView {...props({ selectedId: budget.policyId, history })} />,
    );
    expect(html).toContain('Version history');
    expect(html).toContain('tighten');
    expect(html).toContain('0123456789'); // short fingerprint
    expect(html).not.toContain('abcdef0123456789abcdef'); // full fingerprint not shown
    expect(html).toContain('Mode');
    expect(html).not.toContain('{&quot;mode');
    expect(html).toContain('Create new version');
    expect(html).toContain('Disable policy');
  });

  it('renders structured approval-authority fields and no free code input', () => {
    const html = renderToString(<PolicyView {...props({ selectedId: authority.policyId })} />);
    expect(html).toContain('Capability prefix');
    expect(html).toContain('Separation of duties');
    expect(html).toContain('Required approver role id');
    expect(html).toContain('TTL (minutes)');
    expect(html).toContain('type="checkbox"');
    expect(html).not.toContain('<textarea');
    expect(html).not.toMatch(/json|script|code/i);
  });

  it('shows a mode select for the budget policy', () => {
    const html = renderToString(
      <PolicyChangeForm policy={budget} submitting={false} onSubmit={() => undefined} />,
    );
    expect(html).toContain('<select');
    expect(html).toContain('Require approval');
    expect(html).not.toContain('<textarea');
  });

  it('the hiring policy is a plain on/off switch with no settings to type', () => {
    const { currentVersion: _never, ...unconfigured } = budget;
    void _never;
    const off = renderToString(
      <PolicyChangeForm
        policy={{
          ...unconfigured,
          policyId: 'POLICY_HIRING_CHANNEL',
          title: 'Hiring through hiring requests',
          enabled: false,
          config: undefined,
        }}
        submitting={false}
        onSubmit={() => undefined}
      />,
    ).replace(/<!-- -->/g, '');
    expect(off).toContain('people join only through a hiring request');
    expect(off).toContain('>Turn on<');
    expect(off).not.toContain('Enable policy');
    expect(off).not.toContain('<select');
    expect(off).not.toContain('Capability prefix');

    const on = renderToString(
      <PolicyChangeForm
        policy={{
          ...budget,
          policyId: 'POLICY_HIRING_CHANNEL',
          currentVersion: 1,
          enabled: true,
          config: { directHire: 'deny' },
        }}
        submitting={false}
        onSubmit={() => undefined}
      />,
    ).replace(/<!-- -->/g, '');
    expect(on).toContain('Disable policy');
    expect(on).not.toContain('>Turn on<');
    expect(on).not.toContain('Create new version');
  });

  it('hides the manage form without policy.manage and for platform policies', () => {
    const readOnly = renderToString(
      <PolicyView {...props({ selectedId: budget.policyId, canManage: false })} />,
    );
    expect(readOnly).not.toContain('Create new version');
    expect(readOnly).toContain('cannot change policies');
    const platformHtml = renderToString(
      <PolicyView {...props({ selectedId: platform.policyId })} />,
    );
    expect(platformHtml).not.toContain('Create new version');
    expect(platformHtml).toContain('platform-managed');
  });

  it.each([
    '403 Missing capability policy.manage',
    '409 Policy changed; expected version 3',
    '422 Invalid policy configuration',
  ])('displays the server error %s', (message) => {
    const html = renderToString(
      <PolicyView {...props({ selectedId: budget.policyId, actionError: message })} />,
    );
    expect(html).toContain('role="alert"');
    expect(html).toContain(message);
  });

  it('shows the list error state', () => {
    const html = renderToString(<PolicyView {...props({ error: 'Forbidden', policies: [] })} />);
    expect(html).toContain('Forbidden');
  });
});

describe('policy form helpers', () => {
  it('rejects non id-like prefixes and out-of-range ttl', () => {
    expect(validateRuleDrafts([{ ...emptyRuleDraft(), capabilityPrefix: '${x}' }])).toMatch(
      /capability prefix/,
    );
    expect(
      validateRuleDrafts([{ ...emptyRuleDraft(), capabilityPrefix: 'a.b', ttlMinutes: '0' }]),
    ).toMatch(/TTL/);
    expect(validateRuleDrafts([{ ...emptyRuleDraft(), capabilityPrefix: 'finance.' }])).toBeNull();
  });
  it('builds only allow-listed keys', () => {
    expect(
      rulesToConfig([
        {
          capabilityPrefix: 'finance.',
          separationOfDuties: true,
          requiredApproverRoleId: '',
          ttlMinutes: '30',
        },
      ]),
    ).toEqual({
      rules: [{ capabilityPrefix: 'finance.', separationOfDuties: true, ttlMinutes: 30 }],
    });
  });
  it('formats relative time', () => {
    const now = Date.parse('2026-08-20T10:00:00.000Z');
    expect(relativeTo('2026-08-20T10:30:00.000Z', now)).toBe('in 30 min');
    expect(relativeTo('2026-08-20T09:00:00.000Z', now)).toBe('60 min ago'.replace('60 min', '1 h'));
  });
  it('gates nav by permission', () => {
    expect(isModuleVisible('Policy', [])).toBe(false);
    expect(isModuleVisible('Policy', ['policy.read'])).toBe(true);
    expect(isModuleVisible('Approval Queue', ['approvals.decide'])).toBe(true);
  });
});

const pending: ApprovalGovernanceDto = {
  id: 'apr_1',
  capabilityId: 'finance.approve_expense',
  toolId: 'finance.approve_expense',
  requesterId: 'usr_req',
  requesterName: 'Riley Requester',
  status: 'awaiting_approval',
  createdAt: '2026-08-20T10:00:00.000Z',
  expiresAt: '2026-08-20T11:00:00.000Z',
  requiredApproverRoleId: 'finance.cfo',
  separationOfDuties: true,
  policy: { policyId: 'POLICY_APPROVAL_AUTHORITY', version: 2, outcome: 'REQUIRE_APPROVAL' },
  canDecide: false,
  denyReason: 'SELF_APPROVAL_FORBIDDEN',
  reason: 'Vendor payment',
};

describe('ApprovalsView', () => {
  const base = {
    organizationName: 'Acme',
    workspaceName: 'Finance',
    loading: false,
    error: null,
    decidingId: null,
    actionError: null,
    onDecide: () => undefined,
    onRefresh: () => undefined,
    now: Date.parse('2026-08-20T10:00:00.000Z'),
  };
  it('renders governance facts and decide buttons', () => {
    const html = renderToString(<ApprovalsView {...base} approvals={[pending]} />);
    for (const text of [
      'Riley Requester',
      'finance.approve_expense',
      'Vendor payment',
      'finance.cfo',
      'Separation of duties',
      'in 60 min'.replace('60 min', '1 h'),
      'POLICY_APPROVAL_AUTHORITY v2',
      'SELF_APPROVAL_FORBIDDEN',
      'Approve',
      'Reject',
    ]) {
      expect(html).toContain(text);
    }
  });
  it.each(['403 Wrong approver role', '409 Already decided', '410 Approval expired'])(
    'shows server error %s',
    (message) => {
      const html = renderToString(
        <ApprovalsView {...base} approvals={[pending]} actionError={message} />,
      );
      expect(html).toContain(message);
    },
  );
  it('shows the empty state', () => {
    expect(renderToString(<ApprovalsView {...base} approvals={[]} />)).toContain(
      'No pending approvals',
    );
  });
});

describe('ApprovalCard governance rows', () => {
  it('shows expiry, required approver and separation of duties when present', () => {
    const html = renderToString(
      <ApprovalCard
        approval={{
          id: 'apr_1',
          stepId: 's',
          capabilityId: 'finance.x',
          toolId: 'finance.x',
          status: 'pending',
          sideEffectClass: 'consequential',
          expiresAt: '2026-08-20T11:00:00.000Z',
          requiredApproverRoleId: 'finance.cfo',
          separationOfDuties: true,
        }}
        deciding={false}
        onApprove={() => undefined}
        onReject={() => undefined}
      />,
    );
    expect(html).toContain('Expires');
    expect(html).toContain('finance.cfo');
    expect(html).toContain('Separation of duties');
  });
});

describe('Runtime approvals', () => {
  const run = {
    id: 'run_1',
    actorId: 'a',
    origin: 'chat',
    startedAt: '2026-08-20T10:00:00.000Z',
    endedAt: '2026-08-20T10:00:02.000Z',
    durationMs: 2000,
    status: 'blocked',
    models: [],
    tools: [],
    policies: [],
    approval: { approvalId: 'apr_1', state: 'expired' },
    tokenUsage: { available: false, promptTokens: 0, completionTokens: 0, totalTokens: 0 },
    cost: { estimated: null },
  } as RuntimeRunDto;
  const metrics: RuntimeMetricsDto = {
    window: { from: '2026-08-19T10:00:00.000Z', to: '2026-08-20T10:00:00.000Z' },
    truncated: false,
    summary: {
      runs: 1,
      failureRate: 0,
      denied: 0,
      latencyMs: { p50: 1, p95: 2 },
      tools: { calls: 0, failed: 0 },
      models: { calls: 0, failed: 0 },
      policyDenials: 0,
      approvals: { opened: 4, resumed: 2, rejected: 1, expired: 5 },
    },
  };
  it('shows expired approvals and counters only when present', () => {
    const html = renderToString(
      <RuntimeView
        organizationName="A"
        workspaceName="B"
        runs={[run]}
        metrics={metrics}
        loading={false}
        error={null}
        filters={{ status: 'all', failureStage: 'all' }}
        onFiltersChange={() => undefined}
        selectedId={null}
        onSelect={() => undefined}
        detail={null}
        detailLoading={false}
        detailError={null}
        onRefresh={() => undefined}
      />,
    );
    expect(html).toContain('Expired');
    expect(html).toContain('Approvals expired');
    const without = renderToString(
      <MetricsStrip
        metrics={{ ...metrics, summary: { ...metrics.summary, approvals: undefined } }}
      />,
    );
    expect(without).not.toContain('Approvals expired');
  });
});
