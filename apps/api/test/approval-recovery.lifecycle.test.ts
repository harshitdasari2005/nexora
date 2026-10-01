/**
 * `executing` recovery — lifecycle sweep, audit event and notification policy.
 *
 * A stuck `executing` approval is failed RECOVERY_REQUIRED by the lazy sweep
 * (never re-executed), `approval.recovery_required` is published exactly once,
 * the audit projection shows it, and the recovery only marks the approval (it
 * does not touch a composite workflow instance — see GOVERNED_EXECUTION.md).
 */

import { describe, expect, it } from 'vitest';
import {
  APPROVAL_RECOVERY_REQUIRED_ERROR,
  EXECUTING_LEASE_MS,
  InMemoryApprovalEngine,
} from '@nexora/ai-runtime';
import { NotificationPolicy } from '@nexora/module-notifications';
import type { EventEnvelope, EventPublisher } from '@nexora/shared/events';

import { createApprovalLifecycle } from '../src/ai/approval-governance.js';

const T0 = Date.parse('2026-09-01T09:00:00.000Z');

function harness() {
  let now = T0;
  const approvals = new InMemoryApprovalEngine({ clock: { now: () => new Date(now) } });
  const published: EventEnvelope[] = [];
  const publisher = {
    publish: async (events: readonly EventEnvelope[]) => {
      published.push(...events);
    },
  } as unknown as EventPublisher;
  const lifecycle = createApprovalLifecycle(approvals, publisher);
  const open = (overrides: { tenantId?: string; toolId?: string } = {}) => {
    const request = approvals.open({
      conversationId: 'conv_1',
      userId: 'usr_alice',
      tenantId: overrides.tenantId ?? 'org_1',
      workspaceId: 'wsp_1',
      runId: 'run_1',
      stepId: 'step_1',
      toolId: overrides.toolId ?? 'finance.submit_expense',
      capabilityId: overrides.toolId ?? 'finance.submit_expense',
      sideEffectClass: 'consequential',
      reason: 'needs approval',
      intent: 'submit expense',
      input: { amount: 5 },
    });
    approvals.decide(request.id, { decision: 'grant', decidedBy: 'usr_bob' });
    return request;
  };
  return {
    approvals,
    lifecycle,
    published,
    open,
    advance: (ms: number) => {
      now += ms;
    },
  };
}

describe('approval recovery sweep', () => {
  it('fails a stuck executing approval once, publishes approval.recovery_required once', async () => {
    const h = harness();
    const stuck = h.open();
    expect(h.approvals.claim(stuck.id)).toBe(true);

    await h.lifecycle.sweepApprovals();
    expect(h.published).toEqual([]);

    h.advance(EXECUTING_LEASE_MS);
    await h.lifecycle.sweepApprovals();
    await h.lifecycle.sweepApprovals();
    expect(h.published.map((event) => event.type)).toEqual(['approval.recovery_required']);
    expect(h.published[0]?.payload).toMatchObject({
      approvalId: stuck.id,
      organizationId: 'org_1',
      requesterId: 'usr_alice',
      toolId: 'finance.submit_expense',
    });
    expect(h.published[0]?.actor).toEqual({ kind: 'system', id: 'approval-recovery' });
    const after = h.approvals.byId(stuck.id);
    expect(after).toMatchObject({ status: 'failed', error: APPROVAL_RECOVERY_REQUIRED_ERROR });
    // only the approval is marked: no result, and the approved input is untouched
    expect(after?.result).toBeUndefined();
    expect(after?.input).toEqual({ amount: 5 });
  });

  it('a completed approval is never recovered or re-published', async () => {
    const h = harness();
    const done = h.open();
    h.approvals.claim(done.id);
    h.approvals.recordOutcome(done.id, { status: 'completed', result: { ok: true } });
    h.advance(EXECUTING_LEASE_MS * 4);
    await h.lifecycle.sweepApprovals();
    expect(h.published).toEqual([]);
    expect(h.approvals.byId(done.id)?.status).toBe('completed');
  });

  it('a composite (workflow) approval is only marked; reconciliation stays with the operator', async () => {
    const h = harness();
    const composite = h.open({ toolId: 'workflow.hire_and_assign_employee' });
    h.approvals.claim(composite.id);
    h.advance(EXECUTING_LEASE_MS + 1);
    const recovered = await h.lifecycle.sweepStaleExecutions();
    expect(recovered).toHaveLength(1);
    expect(recovered[0]).toMatchObject({
      toolId: 'workflow.hire_and_assign_employee',
      status: 'failed',
      error: APPROVAL_RECOVERY_REQUIRED_ERROR,
    });
  });

  it('projects into the audit activity feed with an explicit unknown-outcome body', async () => {
    const h = harness();
    const stuck = h.open();
    h.approvals.claim(stuck.id);
    h.advance(EXECUTING_LEASE_MS);
    await h.lifecycle.sweepApprovals();
    const outcome = new NotificationPolicy().evaluate(h.published[0] as EventEnvelope);
    expect(outcome.notifications).toEqual([]);
    expect(outcome.activity).toHaveLength(1);
    expect(outcome.activity[0]).toMatchObject({
      type: 'approval.recovery_required',
      title: 'Approval recovery required: finance.submit_expense',
    });
    expect(outcome.activity[0]?.body).toContain(`approval: ${stuck.id}`);
    expect(outcome.activity[0]?.body).toContain('verify state before re-requesting');
  });
});
