/**
 * Server-render smoke tests for the Runtime Runs page (same convention as
 * the other `*-page.test.tsx` files): list columns, detail timeline,
 * unknown usage/cost labels, and the error / 403 state.
 */

import { describe, expect, it } from 'vitest';
import { renderToString } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';

import { RunDetail, RuntimeView, type RuntimeViewProps } from '../src/pages/Runtime.js';
import type { RuntimeMetricsDto, RuntimeRunDetailDto, RuntimeRunDto } from '../src/lib/types.js';

function run(overrides: Partial<RuntimeRunDto> = {}): RuntimeRunDto {
  return {
    id: 'run_1',
    actorId: 'usr_actor',
    agentId: 'agt_ops',
    origin: 'chat',
    startedAt: '2026-08-20T10:00:00.000Z',
    endedAt: '2026-08-20T10:00:02.000Z',
    durationMs: 2000,
    status: 'failed',
    failure: { stage: 'EXECUTION', code: 'TOOL_EXECUTION_FAILED', class: 'EXECUTION' },
    models: [],
    tools: [
      { invocationId: 'inv_1', toolId: 'projects.create', status: 'failed', durationMs: 1500 },
    ],
    policies: [],
    approval: { approvalId: 'apr_1', state: 'resumed', waitMs: 60000 },
    provider: 'ollama',
    model: 'llama3',
    modelExecution: 'local',
    tokenUsage: { available: false, promptTokens: 0, completionTokens: 0, totalTokens: 0 },
    cost: { estimated: null },
    ...overrides,
  };
}

const metrics: RuntimeMetricsDto = {
  window: { from: '2026-08-19T10:00:00.000Z', to: '2026-08-20T10:00:00.000Z' },
  truncated: false,
  summary: {
    runs: 12,
    failureRate: 0.25,
    denied: 1,
    latencyMs: { p50: 800, p95: 2400 },
    tools: { calls: 9, failed: 2 },
    models: { calls: 10, failed: 1 },
    policyDenials: 3,
  },
};

const detail: RuntimeRunDetailDto = {
  run: run(),
  timeline: [
    { stage: 'REQUEST', durationMs: 5, count: 1, status: 'ok', items: [] },
    {
      stage: 'POLICY',
      durationMs: 12,
      count: 1,
      status: 'ok',
      items: [{ policyId: 'pol_1', version: '3', outcome: 'REQUIRE_APPROVAL', secret: 'LEAK' }],
    },
    {
      stage: 'EXECUTION',
      durationMs: 1500,
      count: 1,
      status: 'failed',
      items: [{ invocationId: 'inv_1', toolId: 'projects.create', status: 'failed', args: 'LEAK' }],
    },
    {
      stage: 'NARRATION',
      durationMs: 300,
      count: 1,
      status: 'ok',
      items: [
        {
          provider: 'ollama',
          model: 'llama3',
          execution: 'local',
          usageAvailable: false,
          cost: null,
        },
      ],
    },
  ],
  bottleneck: {
    tool: { invocationId: 'inv_1', toolId: 'projects.create', durationMs: 1500, share: 0.75 },
  },
};

function props(overrides: Partial<RuntimeViewProps> = {}): RuntimeViewProps {
  return {
    organizationName: 'Acme Inc.',
    workspaceName: 'Engineering',
    runs: [run()],
    metrics,
    loading: false,
    error: null,
    filters: { status: 'all', failureStage: 'all' },
    onFiltersChange: () => undefined,
    selectedId: null,
    onSelect: () => undefined,
    detail: null,
    detailLoading: false,
    detailError: null,
    onRefresh: () => undefined,
    ...overrides,
  };
}

describe('RuntimeView', () => {
  it('renders the list columns, row data, metrics strip and filters', () => {
    const html = renderToString(<RuntimeView {...props()} />);
    for (const column of [
      'Time',
      'Status',
      'Duration',
      'Actor',
      'Agent',
      'Model',
      'Tool Calls',
      'Approvals',
      'Failure Stage',
    ]) {
      expect(html).toContain(`<th>${column}</th>`);
    }
    expect(html).toContain('usr_actor');
    expect(html).toContain('agt_ops');
    expect(html).toContain('ollama/llama3');
    expect(html).toContain('EXECUTION');
    expect(html).toContain('2.00 s');
    expect(html).toContain('Window:');
    expect(html).toContain('25.0%');
    expect(html).toContain('p95 latency');
    expect(html).toContain('Policy denials');
    expect(html).toContain('Filter by status');
    expect(html).toContain('Filter by failure stage');
    expect(html).toContain('Select a run');
  });

  it('renders an empty state', () => {
    expect(renderToString(<RuntimeView {...props({ runs: [] })} />)).toContain('No runtime runs');
  });

  it('renders the error / 403 state instead of the list', () => {
    const html = renderToString(
      <RuntimeView {...props({ error: 'You do not have permission to view runtime telemetry' })} />,
    );
    expect(html).toContain('do not have permission');
    expect(html).not.toContain('Tool Calls');
  });
});

describe('RunDetail', () => {
  const html = renderToString(<RunDetail detail={detail} />).replace(/<!-- -->/g, '');

  it('renders only present stages in order with ids and safe metadata', () => {
    expect(html.indexOf('>REQUEST<')).toBeLessThan(html.indexOf('>POLICY<'));
    expect(html.indexOf('>POLICY<')).toBeLessThan(html.indexOf('>EXECUTION<'));
    expect(html.indexOf('>EXECUTION<')).toBeLessThan(html.indexOf('>NARRATION<'));
    expect(html).not.toContain('PLANNING');
    expect(html).toContain('pol_1');
    expect(html).toContain('REQUIRE_APPROVAL');
    expect(html).toContain('inv_1');
    expect(html).toContain('projects.create');
  });

  it('shows failure, bottleneck and separate approval wait', () => {
    expect(html).toContain('Failed at EXECUTION: TOOL_EXECUTION_FAILED (EXECUTION)');
    expect(html).toContain('Slowest: tool projects.create');
    expect(html).toContain('Approval wait 60.00 s');
  });

  it('labels unknown usage and cost instead of showing 0, and never dumps unknown fields', () => {
    expect(html).toContain('usage not reported');
    expect(html).toContain('cost unavailable');
    expect(html).not.toContain('LEAK');
  });

  it('shows real usage and cost when reported', () => {
    const reported = renderToString(
      <RunDetail
        detail={{
          ...detail,
          run: run({
            tokenUsage: { available: true, promptTokens: 10, completionTokens: 5, totalTokens: 15 },
            cost: { estimated: 0.002, currency: 'USD' },
          }),
        }}
      />,
    );
    const text = reported.replace(/<!-- -->/g, '');
    expect(text).toContain('15 tokens');
    expect(text).toContain('0.002 USD');
  });
});

const governance: NonNullable<RuntimeRunDetailDto['governance']> = {
  actors: {
    requester: { userId: 'usr_req', name: 'Riley Requester' },
    agent: { agentId: 'agt_ops', delegationId: 'dlg_7' },
    approver: { userId: 'usr_appr', name: 'Avery Approver', decidedAt: '2026-08-20T10:01:00.000Z' },
    executor: { kind: 'agent', userId: 'usr_req', agentId: 'agt_ops' },
    executionAuthority: 'agent_delegation',
  },
  approval: {
    id: 'apr_1',
    status: 'approved',
    requesterId: 'usr_req',
    approverId: 'usr_appr',
    requiredApproverRoleId: 'role_finance_lead',
    separationOfDuties: true,
    approvedInputFingerprint: 'abcdef0123456789abcdef',
  },
  policies: [],
  executions: [
    {
      invocationId: 'inv_a',
      toolId: 'projects.create',
      status: 'succeeded',
      matchesApproved: true,
      verification: { verified: true, source: 'state_readback' },
    },
    {
      invocationId: 'inv_b',
      toolId: 'hr.hire',
      status: 'succeeded',
      matchesApproved: false,
      verification: { verified: true, source: 'handler_result', limitation: 'no read-back API' },
    },
  ],
  links: { auditEventId: 'apr:apr_1' },
};

describe('RunDetail governance', () => {
  const text = (d: RuntimeRunDetailDto): string =>
    renderToString(<RunDetail detail={d} />).replace(/<!-- -->/g, '');

  it('renders requester and approver as distinct actors', () => {
    const html = text({ ...detail, governance });
    expect(html).toContain('Requested by');
    expect(html).toContain('Riley Requester (usr_req)');
    expect(html).toContain('Avery Approver (usr_appr)');
    expect(html).toContain('agt_ops · delegation dlg_7');
    expect(html).toContain('Agent&#x27;s delegation');
    expect(html).toContain('Separation of duties enforced');
    expect(html).toContain('role_finance_lead');
    expect(html).toContain('abcdef012345…');
    expect(html).not.toContain('abcdef0123456789abcdef</span>');
    // Without a scope the audit reference is not a link.
    expect(html).toContain('Recorded in the Audit Center');
  });

  it('links the run to its decision trace in the Audit Center (scoped deep link)', () => {
    const html = renderToString(
      <MemoryRouter>
        <RunDetail
          detail={{ ...detail, governance }}
          scope={{ organizationId: 'org_1', workspaceId: 'wsp_1' }}
        />
      </MemoryRouter>,
    );
    expect(html).toContain(
      'href="/app/audit?organizationId=org_1&amp;workspaceId=wsp_1&amp;event=apr%3Aapr_1"',
    );
    expect(html).toContain('Open the decision trace in the Audit Center');
  });

  it('labels handler_result as not independently verified and read-back as verified', () => {
    const html = text({ ...detail, governance });
    expect(html).toContain('Verified by state read-back');
    expect(html).toContain('Reported by the tool — not independently verified');
    expect(html).toContain('Limitation: no read-back API');
    expect(html).toContain('matches approved input: no');
  });

  it('says no approval required when absent and renders nothing when governance is absent', () => {
    const none = text({
      ...detail,
      governance: {
        ...governance,
        approval: undefined,
        actors: { ...governance.actors, approver: undefined, agent: undefined },
        links: { auditEventId: null },
      },
    });
    expect(none).toContain('no approval required');
    expect(none).not.toContain('Audit trace');
    expect(text(detail)).not.toContain('Governance');
  });

  it('does not leak unknown fields', () => {
    const leaky = {
      ...governance,
      secret: 'LEAK',
      actors: { ...governance.actors, token: 'LEAK' },
    } as unknown as NonNullable<RuntimeRunDetailDto['governance']>;
    expect(text({ ...detail, governance: leaky })).not.toContain('LEAK');
  });
});
