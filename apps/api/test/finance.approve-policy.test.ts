/**
 * Approve-time policy for expenses (`POST /api/finance/expenses/:id/decide`).
 *
 * The submit-time budget-limit check is a snapshot: N pending expenses can each
 * pass it, and only the APPROVAL moves money. So an approve re-evaluates the
 * SAME central policy (origin `rest`) over the CURRENT persisted facts.
 * Business rule (existing policy model only, no new thresholds):
 *   - no POLICY_FINANCE_BUDGET_LIMIT configured -> an overrun is allowed;
 *   - `deny` -> an approval that would push approved spend over the allocation
 *     is refused (403 POLICY_DENIED); final, an approval cannot override it;
 *   - `require_approval` -> the deciding human's approve IS that approval.
 * The approved amount is the persisted amount; a refusal changes nothing.
 */

import { describe, expect, it } from 'vitest';

import { chatClientWithSecondUser, onboardOrgAndWorkspace } from './helpers.js';

const LIMIT = 'POLICY_FINANCE_BUDGET_LIMIT';

async function setup() {
  const client = await chatClientWithSecondUser();
  const { organizationId, workspaceId: adminWorkspaceId } = await onboardOrgAndWorkspace(client);
  const created = await client.post('/api/workspaces', {
    organizationId,
    name: 'Finance',
    slug: 'finance',
    type: 'finance',
  });
  const workspaceId = (created.json() as { workspace: { id: string } }).workspace.id;
  await client.second.join({ organizationId, workspaceId, workspaceRole: 'member' });

  const budgetRes = await client.post('/api/finance/budgets', {
    organizationId,
    workspaceId,
    name: 'Ops',
    allocatedMinorUnits: 100_000,
    currency: 'INR',
    periodStart: '2026-07-01T00:00:00.000Z',
    periodEnd: '2026-09-30T00:00:00.000Z',
  });
  const budgetId = (budgetRes.json() as { budget: { id: string } }).budget.id;

  const submit = async (amountMinorUnits: number): Promise<string> => {
    const response = await client.post('/api/finance/expenses', {
      organizationId,
      workspaceId,
      budgetId,
      description: 'Vendor',
      amountMinorUnits,
      currency: 'INR',
    });
    expect(response.statusCode).toBe(201);
    return (response.json() as { expense: { id: string } }).expense.id;
  };
  const decide = (expenseId: string, decision: 'approve' | 'reject') =>
    client.second.post(`/api/finance/expenses/${expenseId}/decide`, {
      organizationId,
      workspaceId,
      decision,
    });
  const spent = async (): Promise<number> => {
    const response = await client.get(
      `/api/finance/budgets/utilization?organizationId=${organizationId}&workspaceId=${workspaceId}`,
    );
    return (
      (
        response.json() as { utilization: { budgetId: string; spentMinorUnits: number }[] }
      ).utilization.find((u) => u.budgetId === budgetId)?.spentMinorUnits ?? 0
    );
  };
  const status = async (expenseId: string): Promise<string> => {
    const response = await client.get(
      `/api/finance/expenses/${expenseId}?organizationId=${organizationId}&workspaceId=${workspaceId}`,
    );
    return (response.json() as { expense: { status: string } }).expense.status;
  };
  const setLimit = (body: Record<string, unknown>) =>
    client.post(
      `/api/policy/policies/${LIMIT}/versions?organizationId=${organizationId}&workspaceId=${adminWorkspaceId}`,
      body,
    );
  return { client, submit, decide, spent, status, setLimit };
}

describe('expenses.decide approve — policy re-evaluated over current persisted facts', () => {
  it('no limit configured: an approval that overruns the allocation is allowed (default unchanged)', async () => {
    const t = await setup();
    const id = await t.submit(150_000);
    expect((await t.decide(id, 'approve')).statusCode).toBe(200);
    expect(await t.spent()).toBe(150_000);
    await t.client.app.close();
  });

  it('deny limit: both pass at submit, the second approve that would exceed is refused at decide; utilization unchanged', async () => {
    const t = await setup();
    expect((await t.setLimit({ config: { mode: 'deny' }, reason: 'hard stop' })).statusCode).toBe(
      201,
    );
    // Approved spend is 0 at submit time, so each 60,000 passes on its own.
    const first = await t.submit(60_000);
    const second = await t.submit(60_000);

    const approvedFirst = await t.decide(first, 'approve');
    expect(approvedFirst.statusCode).toBe(200);
    expect(
      (approvedFirst.json() as { expense: { amountMinorUnits: number } }).expense.amountMinorUnits,
    ).toBe(60_000);
    expect(await t.spent()).toBe(60_000);

    // 60,000 approved + 60,000 > 100,000: refused, final, nothing moves.
    const refused = await t.decide(second, 'approve');
    expect(refused.statusCode).toBe(403);
    expect(refused.json()).toMatchObject({
      error: { code: 'POLICY_DENIED', policy: { policyId: LIMIT, reasonCode: 'BUDGET_OVERRUN' } },
    });
    expect(await t.spent()).toBe(60_000);
    expect(await t.status(second)).toBe('pending');

    // Re-trying cannot override a DENY; rejecting the expense still works.
    expect((await t.decide(second, 'approve')).statusCode).toBe(403);
    expect((await t.decide(second, 'reject')).statusCode).toBe(200);
    expect(await t.spent()).toBe(60_000);
    await t.client.app.close();
  });

  it('deny limit: an approval that fits stays allowed (exactly at the allocation)', async () => {
    const t = await setup();
    await t.setLimit({ config: { mode: 'deny' } });
    const a = await t.submit(60_000);
    const b = await t.submit(40_000);
    expect((await t.decide(a, 'approve')).statusCode).toBe(200);
    expect((await t.decide(b, 'approve')).statusCode).toBe(200);
    expect(await t.spent()).toBe(100_000);
    await t.client.app.close();
  });

  it('concurrent approvals cannot both pass the deny limit', async () => {
    const t = await setup();
    await t.setLimit({ config: { mode: 'deny' } });
    const a = await t.submit(60_000);
    const b = await t.submit(60_000);
    const [ra, rb] = await Promise.all([t.decide(a, 'approve'), t.decide(b, 'approve')]);
    expect([ra.statusCode, rb.statusCode].sort()).toEqual([200, 403]);
    expect(await t.spent()).toBe(60_000);
    await t.client.app.close();
  });

  it('require_approval limit: the deciding human approve IS the approval (allowed)', async () => {
    const t = await setup();
    await t.setLimit({ config: { mode: 'require_approval' } });
    const a = await t.submit(150_000);
    expect((await t.decide(a, 'approve')).statusCode).toBe(200);
    expect(await t.spent()).toBe(150_000);
    await t.client.app.close();
  });

  it('rejection is never policy-gated, even under a deny limit', async () => {
    const t = await setup();
    await t.setLimit({ config: { mode: 'deny' } });
    const a = await t.submit(60_000);
    const b = await t.submit(60_000);
    await t.decide(a, 'approve');
    expect((await t.decide(b, 'reject')).statusCode).toBe(200);
    expect(await t.status(b)).toBe('rejected');
    await t.client.app.close();
  });
});
