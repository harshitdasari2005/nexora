/**
 * Decision trace: client request shaping (encoded id, scope in the
 * querystring) and server-rendered presentation (no DOM required).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToString } from 'react-dom/server';

import { getDecisionTrace, hasDecisionTrace, type DecisionTraceDto } from '../src/lib/audit.js';
import { DecisionTraceBody, DecisionTraceView } from '../src/components/DecisionTrace.js';
import { EventDetail } from '../src/pages/Audit.js';
import type { AuditEventDto } from '../src/lib/types.js';

function trace(overrides: Partial<DecisionTraceDto> = {}): DecisionTraceDto {
  return {
    eventId: 'apr:1',
    request: { text: 'Hire a designer', organizationId: 'org_1', workspaceId: 'wsp_1' },
    evidence: [
      {
        evidenceId: 'ev1',
        sourceType: 'document',
        sourceId: 'doc_9',
        title: 'Hiring policy',
        version: '3',
        trust: 'internal',
        derived: false,
        fingerprint: 'abcdef0123456789abcdef',
      },
      { evidenceId: 'ev2', sourceType: 'finding', sourceId: 'fnd_1', derived: true },
    ],
    authorization: { agentId: 'agt_1', delegationIds: ['dlg_1'], origin: 'agent' },
    policy: { id: 'pol_1', version: '2', outcome: 'REQUIRE_APPROVAL', rules: ['r1'] },
    approval: { id: 'apr_1', status: 'approved', inputFingerprint: 'ffff' },
    planned: [{ toolId: 'hr.hire', requiresApproval: true }],
    executions: [
      {
        invocationId: 'inv_1',
        toolId: 'hr.hire',
        status: 'completed',
        verified: false,
        affectedResource: { type: 'employee', id: 'emp_1' },
        matchesApprovedInput: false,
      },
      {
        invocationId: 'inv_2',
        toolId: 'hr.remove',
        status: 'completed',
        verified: true,
        workflow: { stepId: 's2', purpose: 'compensation' },
      },
    ],
    lineage: [{ recordId: 'l1', kind: 'EXECUTION', occurredAt: '2026-08-20T10:00:00.000Z' }],
    ...overrides,
  };
}

describe('decision trace client', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify({ trace: trace() }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
    );
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  it('URL-encodes the event id and sends scope in the querystring', async () => {
    const result = await getDecisionTrace(
      { organizationId: 'org_1', workspaceId: 'wsp_1' },
      'apr:abc',
    );
    expect(result.eventId).toBe('apr:1');
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/audit/events/apr%3Aabc/trace?organizationId=org_1&workspaceId=wsp_1');
    expect(init.method).toBeUndefined();
  });

  it('only apr:/agx:/wfs: events are eligible for a trace', () => {
    expect(['apr:1', 'agx:1', 'wfs:1'].every(hasDecisionTrace)).toBe(true);
    expect(hasDecisionTrace('act:1')).toBe(false);
  });
});

describe('DecisionTraceView', () => {
  it('distinguishes derived findings from source evidence and shortens fingerprints', () => {
    const html = renderToString(<DecisionTraceView trace={trace()} />);
    expect(html).toContain('Hiring policy');
    expect(html).toContain('Derived finding — not source evidence');
    expect(html.match(/Derived finding — not source evidence/g)).toHaveLength(1);
    expect(html).toContain('title="abcdef0123456789abcdef"');
    expect(html).toContain('abcdef012345…');
    expect(html).toContain('never grants authority');
  });

  it('keeps planned and executed separate and flags an approved-input mismatch', () => {
    const html = renderToString(<DecisionTraceView trace={trace()} />);
    const planned = html.indexOf('data-testid="trace-planned"');
    const executed = html.indexOf('data-testid="trace-executed"');
    expect(planned).toBeGreaterThan(-1);
    expect(executed).toBeGreaterThan(planned);
    expect(html).toContain('Planned (not proof of execution)');
    expect(html).toContain('executed input does not match the approved input');
    expect(html.replace(/<!-- -->/g, '')).toContain('verified no');
    expect(html).toContain('employee');
  });

  it('labels compensation steps distinctly', () => {
    const html = renderToString(<DecisionTraceView trace={trace()} />);
    expect(html).toContain('Compensation step');
  });

  it('does not warn when inputs match', () => {
    const html = renderToString(
      <DecisionTraceView
        trace={trace({ executions: [{ toolId: 'a', verified: true, matchesApprovedInput: true }] })}
      />,
    );
    expect(html).not.toContain('does not match');
  });
});

describe('DecisionTraceBody states', () => {
  it('renders the 404 empty state', () => {
    expect(renderToString(<DecisionTraceBody state={{ kind: 'none' }} />)).toContain(
      'No decision trace is recorded for this event',
    );
  });
  it('renders 403 and error states', () => {
    expect(renderToString(<DecisionTraceBody state={{ kind: 'forbidden' }} />)).toContain(
      'permission',
    );
    expect(
      renderToString(<DecisionTraceBody state={{ kind: 'error', message: 'boom' }} />),
    ).toContain('boom');
  });
});

describe('EventDetail policy', () => {
  it('renders the event policy when present', () => {
    const event: AuditEventDto = {
      id: 'act:1',
      source: 'activity',
      occurredAt: '2026-08-20T10:00:00.000Z',
      actorName: 'A',
      module: 'M',
      action: 'Blocked thing',
      status: 'blocked',
      statusLabel: 'Blocked',
      approvalRequired: false,
      policy: { id: 'pol_x', version: '7', outcome: 'DENY', reason: 'not allowed', rules: ['r9'] },
    };
    const html = renderToString(<EventDetail event={event} />);
    expect(html).toContain('pol_x');
    expect(html).toContain('DENY');
    expect(html).toContain('not allowed');
  });
});

describe('DecisionTraceView governance', () => {
  const html = (t: DecisionTraceDto): string =>
    renderToString(<DecisionTraceView trace={t} />).replace(/<!-- -->/g, '');

  it('renders distinct actors, extended approval and verification details', () => {
    const out = html(
      trace({
        actors: {
          requester: { userId: 'usr_req', name: 'Riley Requester' },
          agent: { agentId: 'agt_1' },
          approver: { userId: 'usr_appr', decidedAt: '2026-08-20T10:01:00.000Z' },
          executor: { kind: 'agent', userId: 'usr_req', agentId: 'agt_1' },
          executionAuthority: 'requester_rbac',
        },
        approval: {
          id: 'apr_1',
          status: 'approved',
          inputFingerprint: 'ffff',
          requester: 'usr_req',
          requiredApproverRoleId: 'role_x',
          separationOfDuties: true,
          expiresAt: '2026-08-21T10:00:00.000Z',
        },
        executions: [
          {
            invocationId: 'i1',
            toolId: 't1',
            verification: {
              verified: true,
              source: 'handler_result',
              limitation: 'tool self-report',
              checks: [
                { ruleId: 'rule_ok', passed: true },
                { ruleId: 'rule_bad', passed: false },
              ],
            },
          },
          {
            invocationId: 'i2',
            toolId: 't2',
            verification: { verified: true, source: 'state_readback' },
          },
        ],
      }),
    );
    expect(out).toContain('Requested by');
    expect(out).toContain('Riley Requester');
    expect(out).toContain('usr_appr');
    expect(out).toContain('Requester&#x27;s role permissions');
    expect(out).toContain('role_x');
    expect(out).toContain('Separation of duties enforced');
    expect(out).toContain('Reported by the tool — not independently verified');
    expect(out).toContain('Limitation: tool self-report');
    expect(out).toContain('Failed checks: rule_bad');
    expect(out).not.toContain('rule_ok');
    expect(out).toContain('Verified by state read-back');
  });

  it('renders no Actors card when absent and does not leak unknown fields', () => {
    const out = html(
      trace({
        actors: {
          requester: { userId: 'usr_req' },
          executor: { kind: 'user', userId: 'usr_req' },
          executionAuthority: 'requester_rbac',
          secret: 'LEAK',
        } as unknown as DecisionTraceDto['actors'],
      }),
    );
    expect(out).not.toContain('LEAK');
    expect(html(trace())).not.toContain('trace-actors');
  });
});

describe('DecisionTraceView workflow section + composite attribution', () => {
  const html = (t: DecisionTraceDto): string =>
    renderToString(<DecisionTraceView trace={t} />).replace(/<!-- -->/g, '');

  const compensated = trace({
    workflow: {
      instanceId: 'wfi_1',
      state: 'compensated',
      rollbackSummary: 'Rolled back: Create employee. Nothing was left behind.',
      note: 'Create employee executed; Assign employee failed (TOOL_FAILED); compensation executed for Create employee. Final workflow state: COMPENSATED.',
      steps: [
        {
          stepId: 'hire_employee',
          toolId: 'hr.create_employee',
          name: 'Create employee',
          purpose: 'step',
          status: 'succeeded',
          laterState: 'compensated',
          compensatedBy: 'compensate:hire_employee',
        },
        {
          stepId: 'assign_employee',
          toolId: 'projects.assign_employee',
          name: 'Assign employee',
          purpose: 'step',
          status: 'failed',
          errorCode: 'TOOL_FAILED',
        },
        {
          stepId: 'compensate:hire_employee',
          toolId: 'hr.revoke_hire',
          name: 'Revoke hire',
          purpose: 'compensation',
          compensatesStepId: 'hire_employee',
          status: 'succeeded',
        },
      ],
    },
    executions: [
      {
        invocationId: 'i1',
        toolId: 'hr.create_employee',
        status: 'succeeded',
        workflow: { stepId: 'hire_employee', purpose: 'step' },
        laterState: 'compensated',
        compensatedBy: 'compensate:hire_employee',
      },
    ],
  });

  it('renders a compensated workflow honestly: executed step, failure, compensation, COMPENSATED — never success', () => {
    const out = html(compensated);
    expect(out).toContain('data-testid="trace-workflow"');
    expect(out).toContain('Compensated — rolled back');
    expect(out).toContain('Create employee — Executed');
    expect(out).toContain('Assign employee — Failed');
    expect(out).toContain('TOOL_FAILED');
    expect(out).toContain('Later compensated — undone by the rollback');
    expect(out).toContain('Final workflow state: COMPENSATED.');
    expect(out).toContain('Rolled back: Create employee');
    // The executed row keeps its own status and references the later state.
    expect(out).toContain('Executed as recorded');
    expect(out).toContain('by compensate:hire_employee');
    // Not rendered as a success.
    expect(out).not.toContain('Verified');
    expect(out).not.toContain('Completed');
  });

  it('flags a step left behind by a partial workflow', () => {
    const out = html(
      trace({
        workflow: {
          instanceId: 'wfi_2',
          state: 'partial',
          rollbackSummary: 'Partially completed — NOT rolled back: Create project.',
          note: 'Create project executed. Final workflow state: PARTIAL.',
          steps: [
            {
              stepId: 'create_project',
              toolId: 'projects.create_project',
              name: 'Create project',
              purpose: 'step',
              status: 'succeeded',
              laterState: 'not_rolled_back',
            },
          ],
        },
      }),
    );
    expect(out).toContain('Partial — rollback incomplete');
    expect(out).toContain('Left behind — not rolled back');
  });

  it('a succeeded workflow shows no later-state or compensation wording', () => {
    const out = html(
      trace({
        workflow: {
          instanceId: 'wfi_3',
          state: 'verified',
          rollbackSummary: '',
          note: 'Create employee executed. Final workflow state: VERIFIED.',
          steps: [
            {
              stepId: 'hire_employee',
              toolId: 'hr.create_employee',
              name: 'Create employee',
              purpose: 'step',
              status: 'succeeded',
            },
          ],
        },
      }),
    );
    expect(out).toContain('Verified');
    expect(out).not.toContain('Later compensated');
    expect(out).not.toContain('Left behind');
  });

  it('explains that a composite approval authorized the unit and the approver executed nothing', () => {
    const out = html(
      trace({
        attribution: {
          approvalScope: 'composite_workflow',
          approvalId: 'apr_1',
          approvedBy: 'usr_appr',
          innerExecutionAuthority: 'workflow_instance_under_requester_ceiling',
          approverExecutedSteps: false,
          innerExecutionCount: 3,
          statement:
            'The approval authorized the composite workflow as a unit. Its inner steps ran under the workflow instance; the approver did not execute any step.',
        },
        executions: [
          {
            invocationId: 'i1',
            toolId: 'hr.create_employee',
            workflow: { stepId: 'hire_employee', purpose: 'step' },
            compositeApproval: {
              approvalId: 'apr_1',
              approvalScope: 'composite_workflow',
              approvedBy: 'usr_appr',
              role: 'authorized_the_composite',
            },
          },
        ],
      }),
    );
    expect(out).toContain('data-testid="trace-attribution"');
    expect(out).toContain('Composite workflow — approved as one unit');
    expect(out).toContain('usr_appr');
    expect(out).toContain('No — the approver did not execute any step');
    expect(out).toContain('within the requester&#x27;s capability ceiling');
    expect(out).toContain('Authorized as part of the composite by approval apr_1');
    expect(out).toContain('the approver did not execute this step');
  });

  it('a non-workflow trace has no workflow or composite sections', () => {
    const out = html(trace());
    expect(out).not.toContain('data-testid="trace-workflow"');
    expect(out).not.toContain('data-testid="trace-attribution"');
  });
});
