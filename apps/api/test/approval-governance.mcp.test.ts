/**
 * Prompt 8 — governed MCP write adapter + expiry sweeper.
 *
 * The adapter passes the policy's approval requirement (TTL, required role,
 * separation of duties) to `approvals.open`, treats an expired approval as
 * APPROVAL_EXPIRED (never executes), and the sweeper publishes
 * `approval.expired` exactly once per transition.
 */

import { describe, expect, it } from 'vitest';
import { InMemoryApprovalEngine } from '@nexora/ai-runtime';
import type { ToolExecutionResult, ToolExecutor } from '@nexora/ai-runtime/execution';
import type { EventEnvelope, EventPublisher } from '@nexora/shared/events';

import { createApprovalLifecycle } from '../src/ai/approval-governance.js';
import { GovernedWriteAdapter } from '../src/ai/mcp/governed-write-adapter.js';

const T0 = Date.parse('2026-01-01T09:00:00.000Z');

function harness() {
  let now = T0;
  const approvals = new InMemoryApprovalEngine({ clock: { now: () => new Date(now) } });
  const calls: { approved: boolean }[] = [];
  const blocked: ToolExecutionResult = {
    ok: false,
    blocked: true,
    error: { code: 'APPROVAL_REQUIRED', message: 'needs approval' },
    policy: {
      outcome: 'REQUIRE_APPROVAL',
      policyId: 'POLICY_SIDE_EFFECT_APPROVAL',
      version: '1',
      reasonCode: 'SIDE_EFFECT',
      reason: 'needs approval',
      matchedRules: [],
      fingerprint: 'fp1',
      evaluatedAt: new Date(now).toISOString(),
      approval: {
        separationOfDuties: true,
        requiredApproverRoleId: 'finance.cfo',
        ttlMinutes: 10,
        policyId: 'POLICY_APPROVAL_AUTHORITY',
        policyVersion: '1+config.1',
      },
    },
  } as never;
  const executor = {
    async execute(_invocation: unknown, approved: boolean) {
      calls.push({ approved });
      return approved ? ({ ok: true, output: { done: true } } as never) : blocked;
    },
  } as unknown as ToolExecutor;
  const adapter = new GovernedWriteAdapter({
    executor,
    approvals,
    toolId: 'finance.submit_expense',
    capabilityId: 'finance.submit_expense',
    intent: 'submit an expense',
  });
  const context = {
    userId: 'usr_req',
    tenantId: 'org_1',
    workspaceId: 'wsp_1',
    correlationId: 'corr_1',
    capabilityIds: ['finance.submit_expense'],
  } as never;
  return {
    approvals,
    adapter,
    calls,
    context,
    advance: (ms: number) => {
      now += ms;
    },
  };
}

describe('governed MCP write adapter — approval governance', () => {
  it('opens the approval with the policy requirement (ttl, required role, SoD)', async () => {
    const h = harness();
    const first = await h.adapter.invoke({ amount: 1 }, h.context);
    expect(first).toMatchObject({ ok: false, error: { code: 'APPROVAL_REQUIRED' } });
    const [approval] = await h.approvals.listByTenant('org_1', { limit: 5 });
    expect(approval).toMatchObject({
      requiredApproverRoleId: 'finance.cfo',
      separationOfDuties: true,
    });
    expect(Date.parse(approval!.expiresAt) - Date.parse(approval!.createdAt)).toBe(10 * 60_000);
  });

  it('an expired approval (granted or pending) is APPROVAL_EXPIRED and never executes', async () => {
    const h = harness();
    await h.adapter.invoke({ amount: 1 }, h.context);
    const [approval] = await h.approvals.listByTenant('org_1', { limit: 5 });
    await h.approvals.decide(approval!.id, { decision: 'grant', decidedBy: 'usr_cfo' });
    h.advance(11 * 60_000);
    const resumed = await h.adapter.invoke({ amount: 1 }, h.context);
    expect(resumed).toMatchObject({ ok: false, error: { code: 'APPROVAL_EXPIRED' } });
    expect(h.calls.filter((call) => call.approved)).toHaveLength(0);
    expect(await h.approvals.claim(approval!.id)).toBe(false);
  });

  it('positive control: a granted, unexpired approval executes once', async () => {
    const h = harness();
    await h.adapter.invoke({ amount: 1 }, h.context);
    const [approval] = await h.approvals.listByTenant('org_1', { limit: 5 });
    await h.approvals.decide(approval!.id, { decision: 'grant', decidedBy: 'usr_cfo' });
    h.advance(5 * 60_000);
    const resumed = await h.adapter.invoke({ amount: 1 }, h.context);
    expect(resumed).toMatchObject({ ok: true });
    expect(h.calls.filter((call) => call.approved)).toHaveLength(1);
  });
});

describe('approval lifecycle sweeper', () => {
  it('publishes approval.expired once per transition (idempotent sweep)', async () => {
    const h = harness();
    const published: EventEnvelope[] = [];
    const publisher: EventPublisher = {
      publish: async (events: readonly EventEnvelope[]) => {
        published.push(...events);
      },
    } as never;
    const lifecycle = createApprovalLifecycle(h.approvals, publisher);
    await h.adapter.invoke({ amount: 1 }, h.context);
    expect(await lifecycle.sweepExpiredApprovals()).toHaveLength(0);
    h.advance(11 * 60_000);
    expect(await lifecycle.sweepExpiredApprovals()).toHaveLength(1);
    expect(await lifecycle.sweepExpiredApprovals()).toHaveLength(0);
    expect(published.map((event) => event.type)).toEqual(['approval.expired']);
    expect(published[0]?.payload).toMatchObject({
      organizationId: 'org_1',
      requiredApproverRoleId: 'finance.cfo',
      separationOfDuties: true,
    });
  });
});
