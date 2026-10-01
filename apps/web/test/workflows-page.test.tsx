/**
 * Workflow state rendering: every composite state renders its own truthful
 * words, and a failed / compensated / partial workflow can NEVER render as a
 * success ("completed", a green tone, a "Workflow completed" line).
 */

import { describe, expect, it } from 'vitest';
import { renderToString } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';

import {
  CompositeApprovalRow,
  StepTimeline,
  WorkflowRow,
  WorkflowStatusBadge,
  WorkflowsView,
} from '../src/pages/Workflows.js';
import { resolveWorkflowState } from '../src/lib/workflowState.js';
import type {
  CompositeApprovalDto,
  WorkflowInstanceDto,
  WorkflowStateKey,
  WorkflowStepExecutionDto,
} from '../src/lib/types.js';

function instance(overrides: Partial<WorkflowInstanceDto> = {}): WorkflowInstanceDto {
  return {
    id: 'wfi_1',
    definitionId: 'wfd_1',
    definitionKey: 'hr.hire_and_assign_employee',
    tenantId: 'org_1',
    userId: 'usr_1',
    correlationId: 'run_1',
    status: 'succeeded',
    startedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function step(overrides: Partial<WorkflowStepExecutionDto> = {}): WorkflowStepExecutionDto {
  return {
    id: 'wfx_1',
    stepId: 'hire_employee',
    name: 'Hire employee',
    capabilityId: 'hr.create_employee',
    toolId: 'hr.create_employee',
    status: 'succeeded',
    attempt: 1,
    startedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

const ALL_STATES: readonly WorkflowStateKey[] = [
  'planned',
  'waiting_for_approval',
  'approved',
  'executing',
  'failed',
  'compensated',
  'partial',
  'verified',
  'completed_unverified',
  'rejected',
  'expired',
  'cancelled',
];

const LABELS: Record<WorkflowStateKey, string> = {
  planned: 'Planned',
  waiting_for_approval: 'Waiting for approval',
  approved: 'Approved',
  executing: 'Executing',
  failed: 'Failed',
  compensated: 'Compensated',
  partial: 'Partial',
  verified: 'Verified',
  completed_unverified: 'Completed — not independently verified',
  rejected: 'Rejected',
  expired: 'Expired',
  cancelled: 'Cancelled',
};

describe('workflow state badges', () => {
  it.each(ALL_STATES)('renders %s with its own words', (state) => {
    const html = renderToString(<WorkflowStatusBadge instance={{ status: 'running', state }} />);
    expect(html).toContain(LABELS[state]);
  });

  it('only a verified instance uses the success tone', () => {
    for (const state of ALL_STATES) {
      const html = renderToString(<WorkflowStatusBadge instance={{ status: 'x', state }} />);
      const green = html.includes('nexora-success');
      expect(green, state).toBe(state === 'verified');
    }
  });

  it.each(['failed', 'compensated', 'partial', 'rejected', 'expired', 'cancelled'] as const)(
    '%s never renders "completed" or "success"',
    (state) => {
      const row = renderToString(
        <WorkflowRow
          workflow={instance({ status: 'failed', state, stateDetail: 'It did not finish.' })}
          selected={false}
          onOpen={() => undefined}
        />,
      );
      expect(row.toLowerCase()).not.toContain('completed');
      expect(row.toLowerCase()).not.toContain('success');
      expect(row).not.toContain('nexora-success');
    },
  );
});

describe('legacy payloads without a server state', () => {
  it('never derives verified or success from a succeeded status', () => {
    expect(resolveWorkflowState({ status: 'succeeded' })).toBe('completed_unverified');
  });
  it('derives partial / compensated / failed from the rollback ledger', () => {
    const ledger = (status: string) => ({
      status: 'failed',
      compensation: { status, compensatedSteps: [], outstanding: [] },
    });
    expect(resolveWorkflowState(ledger('partial'))).toBe('partial');
    expect(resolveWorkflowState(ledger('failed'))).toBe('partial');
    expect(resolveWorkflowState(ledger('compensated'))).toBe('compensated');
    expect(resolveWorkflowState({ status: 'failed' })).toBe('failed');
    expect(resolveWorkflowState({ status: 'compensated' })).toBe('compensated');
  });
});

describe('StepTimeline', () => {
  it('a verified success says Verified and is the only green footer', () => {
    const html = renderToString(
      <StepTimeline
        steps={[step({ verification: { status: 'verified', source: 'state_readback' } })]}
        instance={instance({ state: 'verified', stateDetail: 'Completed and verified.' })}
      />,
    );
    expect(html).toContain('Verified');
    expect(html).toContain('verified by state read-back');
    expect(html).toContain('nexora-success');
  });

  it('a succeeded-but-unverified run states the limitation and is not green', () => {
    const html = renderToString(
      <StepTimeline
        steps={[step({ verification: { status: 'self_reported', limitation: 'no read-back' } })]}
        instance={instance({
          state: 'completed_unverified',
          stateDetail: 'Completed — not independently verified. Limitation: no read-back.',
        })}
      />,
    );
    expect(html).toContain('not independently verified');
    expect(html).toContain('Limitation: no read-back');
    expect(html).not.toContain('nexora-success');
    expect(html).not.toContain('Workflow completed.');
  });

  it('a compensated failure shows the rollback step and no success', () => {
    const html = renderToString(
      <StepTimeline
        steps={[
          step(),
          step({
            id: 'wfx_2',
            stepId: 'assign_employee',
            name: 'Assign',
            status: 'failed',
            errorCode: 'TOOL_FAILED',
            error: 'boom',
          }),
          step({
            id: 'wfx_3',
            stepId: 'compensate:hire_employee',
            name: 'Hire employee',
            purpose: 'compensation',
            compensatesStepId: 'hire_employee',
          }),
        ]}
        instance={instance({
          status: 'failed',
          state: 'compensated',
          stateDetail: 'Failed and rolled back.',
        })}
      />,
    );
    expect(html).toContain('Compensated');
    expect(html).toContain('(rollback)');
    expect(html).toContain('TOOL_FAILED');
    expect(html).not.toContain('nexora-success');
    expect(html.toLowerCase()).not.toContain('workflow completed');
  });

  it('a partial failure is danger-toned and says the rollback is incomplete', () => {
    const html = renderToString(
      <StepTimeline
        steps={[step({ status: 'succeeded' }), step({ id: 'wfx_2', status: 'failed' })]}
        instance={instance({
          status: 'failed',
          state: 'partial',
          stateDetail: 'Failed and only partially completed.',
        })}
      />,
    );
    expect(html).toContain('Partial — rollback incomplete');
    expect(html).toContain('nexora-danger');
    expect(html).not.toContain('nexora-success');
  });
});

describe('pending composites', () => {
  const composite = (overrides: Partial<CompositeApprovalDto> = {}): CompositeApprovalDto => ({
    approvalId: 'apr_1',
    capabilityId: 'workflow.hire_and_assign_employee',
    definitionKey: 'hire_and_assign_employee',
    initiator: 'usr_1',
    state: 'waiting_for_approval',
    stateDetail: 'Waiting for approval — nothing has run and no workflow instance exists yet.',
    createdAt: '2026-01-01T00:00:00.000Z',
    expiresAt: '2026-01-02T00:00:00.000Z',
    ...overrides,
  });

  it('links a waiting composite to approvals', () => {
    const html = renderToString(
      <MemoryRouter>
        <CompositeApprovalRow composite={composite()} />
      </MemoryRouter>,
    );
    expect(html).toContain('Waiting for approval');
    expect(html).toContain('/app/approvals');
    expect(html).toContain('no workflow instance exists yet');
  });

  it('WorkflowsView renders composites even with no instances (not the empty state)', () => {
    const html = renderToString(
      <MemoryRouter>
        <WorkflowsView
          organizationId="org_1"
          organizationName="Acme"
          initialWorkflows={[]}
          initialComposites={[
            composite({
              state: 'rejected',
              stateDetail: 'Approval rejected — the workflow never ran; nothing was changed.',
            }),
          ]}
        />
      </MemoryRouter>,
    );
    expect(html).toContain('Rejected');
    expect(html).not.toContain('No workflows yet');
  });
});
