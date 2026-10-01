/**
 * Prompt 8 — direct human REST mutations consult the central policy.
 *
 * `POST /api/finance/expenses` evaluates the SAME PolicyPort (origin `rest`)
 * as the AI surfaces, over the same trusted facts: a policy DENY is final for
 * a human too (403 `POLICY_DENIED` with policy id/version, nothing persisted,
 * audited as `ai.security.blocked`, origin `rest`); REQUIRE_APPROVAL is the
 * domain's own pending -> decided flow (proceeds, decision recorded in the
 * response); a policy evaluation failure fails closed (503).
 *
 * Harness (same as policy.finance.test.ts): the user creates an
 * `engineering` workspace (CEO: policy.manage + audit.read) and a `finance`
 * workspace (CFO: expenses.create).
 */

import { describe, expect, it } from 'vitest';

import { chatClient, onboardOrgAndWorkspace, type ChatClient } from './helpers.js';

const LIMIT = 'POLICY_FINANCE_BUDGET_LIMIT';
const BUDGET_STATE = 'POLICY_FINANCE_BUDGET_STATE';
const EXPENSE_APPROVAL = 'POLICY_FINANCE_EXPENSE_APPROVAL';

interface Harness {
  client: ChatClient;
  organizationId: string;
  workspaceId: string;
  adminWorkspaceId: string;
}

async function harness(): Promise<Harness> {
  const client = await chatClient();
  const { organizationId, workspaceId: adminWorkspaceId } = await onboardOrgAndWorkspace(client);
  const created = await client.post('/api/workspaces', {
    organizationId,
    name: 'Finance',
    slug: 'finance',
    type: 'finance',
  });
  expect(created.statusCode).toBe(201);
  const workspaceId = (created.json() as { workspace: { id: string } }).workspace.id;
  return { client, organizationId, workspaceId, adminWorkspaceId };
}

async function budget(h: Harness, allocated = 500_000, closed = false): Promise<string> {
  const response = await h.client.post('/api/finance/budgets', {
    organizationId: h.organizationId,
    workspaceId: h.workspaceId,
    name: 'Ops',
    allocatedMinorUnits: allocated,
    currency: 'INR',
    periodStart: '2026-07-01T00:00:00.000Z',
    periodEnd: '2026-09-30T00:00:00.000Z',
  });
  expect(response.statusCode).toBe(201);
  const id = (response.json() as { budget: { id: string } }).budget.id;
  if (closed) {
    const res = await h.client.post(`/api/finance/budgets/${id}/close`, {
      organizationId: h.organizationId,
      workspaceId: h.workspaceId,
    });
    expect(res.statusCode).toBe(200);
  }
  return id;
}

const submit = (h: Harness, budgetId: string, amountMinorUnits = 10_000) =>
  h.client.post('/api/finance/expenses', {
    organizationId: h.organizationId,
    workspaceId: h.workspaceId,
    budgetId,
    description: 'Team offsite',
    amountMinorUnits,
    currency: 'INR',
  });

async function expenseCount(h: Harness): Promise<number> {
  const response = await h.client.get(
    `/api/finance/expenses?organizationId=${h.organizationId}&workspaceId=${h.workspaceId}`,
  );
  return (response.json() as { expenses: unknown[] }).expenses.length;
}

/** Sets an org policy version through the ADMIN API (the CEO persona). */
async function setPolicy(h: Harness, body: Record<string, unknown>) {
  return h.client.post(
    `/api/policy/policies/${LIMIT}/versions?organizationId=${h.organizationId}&workspaceId=${h.adminWorkspaceId}`,
    body,
  );
}

interface AuditEvent {
  source: string;
  status: string;
  detail?: string;
  policy?: { id: string; version: string; outcome: string; rules: readonly string[] };
}

async function blocked(h: Harness): Promise<AuditEvent[]> {
  const response = await h.client.get(
    `/api/audit/events?organizationId=${h.organizationId}&workspaceId=${h.adminWorkspaceId}&source=activity&status=blocked`,
  );
  expect(response.statusCode).toBe(200);
  return (response.json() as { events: AuditEvent[] }).events.filter(
    (event) => event.status === 'blocked',
  );
}

describe('REST expense — central policy (origin rest)', () => {
  it('closed budget: 403 POLICY_DENIED with policy id/version, NO expense, audited as blocked', async () => {
    const h = await harness();
    const closed = await budget(h, 500_000, true);
    const response = await submit(h, closed);
    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({
      error: {
        code: 'POLICY_DENIED',
        policy: { policyId: BUDGET_STATE, version: '1', reasonCode: 'BUDGET_CLOSED' },
      },
    });
    expect(await expenseCount(h)).toBe(0);

    const events = await blocked(h);
    const denial = events.find((event) => event.policy?.id === BUDGET_STATE);
    expect(denial?.policy?.outcome).toBe('DENY');
    expect(denial?.policy?.rules).toContain(`${BUDGET_STATE}@1=DENY`);
    await h.client.app.close();
  });

  it('open budget: allowed (201), policy decision recorded, stays `pending` for the domain approval flow', async () => {
    const h = await harness();
    const open = await budget(h);
    const response = await submit(h, open);
    expect(response.statusCode).toBe(201);
    const body = response.json() as {
      expense: { status: string; budgetId: string };
      policy: { outcome: string; policyId: string; version: string };
    };
    expect(body.expense).toMatchObject({ status: 'pending', budgetId: open });
    // Money movement (BR-19): REQUIRE_APPROVAL, satisfied by the domain's own
    // pending -> decided flow (another actor decides).
    expect(body.policy).toMatchObject({
      outcome: 'REQUIRE_APPROVAL',
      policyId: EXPENSE_APPROVAL,
      version: '1',
    });
    expect(await expenseCount(h)).toBe(1);
    await h.client.app.close();
  });

  it('org-configured FINANCE_BUDGET_LIMIT deny is enforced over REST; a NEW version via the admin API changes REST behavior', async () => {
    const h = await harness();
    const small = await budget(h, 100_000);

    // No configuration: an overrun is not denied by policy.
    expect((await submit(h, small, 150_000)).statusCode).toBe(201);
    expect(await expenseCount(h)).toBe(1);

    // Version 1 (deny): the same overrun is refused; a within-limit request is not.
    const v1 = await setPolicy(h, { config: { mode: 'deny' }, reason: 'hard stop' });
    expect(v1.statusCode).toBe(201);
    const denied = await submit(h, small, 150_000);
    expect(denied.statusCode).toBe(403);
    expect(denied.json()).toMatchObject({
      error: { code: 'POLICY_DENIED', policy: { policyId: LIMIT } },
    });
    expect(await expenseCount(h)).toBe(1);
    const within = await submit(h, small, 10_000);
    // Approved spend is 0 (the first expense is only `submitted`), so this fits.
    expect(within.statusCode).toBe(201);
    expect(await expenseCount(h)).toBe(2);

    // Version 2 (require_approval): the overrun is no longer a DENY.
    const v2 = await setPolicy(h, { config: { mode: 'require_approval' }, reason: 'soften' });
    expect(v2.statusCode).toBe(201);
    const softened = await submit(h, small, 150_000);
    expect(softened.statusCode).toBe(201);
    expect(await expenseCount(h)).toBe(3);

    // Version 3 (deny again) then DISABLED (a new version): disabled config does not apply.
    expect((await setPolicy(h, { config: { mode: 'deny' } })).statusCode).toBe(201);
    expect((await submit(h, small, 150_000)).statusCode).toBe(403);
    expect((await setPolicy(h, { enabled: false })).statusCode).toBe(201);
    expect((await submit(h, small, 150_000)).statusCode).toBe(201);
    await h.client.app.close();
  });

  it('tenant + workspace isolation: forged scope is refused; foreign/other-workspace budgets are plain 404 (no oracle)', async () => {
    const h = await harness();
    const own = await budget(h);
    const foreignScope = await h.client.post('/api/finance/expenses', {
      organizationId: 'org_alien',
      workspaceId: h.workspaceId,
      budgetId: own,
      description: 'x',
      amountMinorUnits: 1_000,
      currency: 'INR',
    });
    expect(foreignScope.statusCode).toBe(403);

    // A budget of another workspace of the SAME tenant is not resolvable here.
    const other = await h.client.post('/api/workspaces', {
      organizationId: h.organizationId,
      name: 'Finance 2',
      slug: 'finance-2',
      type: 'finance',
    });
    const otherWorkspaceId = (other.json() as { workspace: { id: string } }).workspace.id;
    const otherBudget = await h.client.post('/api/finance/budgets', {
      organizationId: h.organizationId,
      workspaceId: otherWorkspaceId,
      name: 'Other',
      allocatedMinorUnits: 500_000,
      currency: 'INR',
      periodStart: '2026-07-01T00:00:00.000Z',
      periodEnd: '2026-09-30T00:00:00.000Z',
    });
    const otherBudgetId = (otherBudget.json() as { budget: { id: string } }).budget.id;
    const cross = await submit(h, otherBudgetId);
    expect(cross.statusCode).toBe(404);
    const ghost = await submit(h, 'bud_00000000-0000-4000-8000-000000000000');
    expect(ghost.statusCode).toBe(404);
    expect(await expenseCount(h)).toBe(0);
    await h.client.app.close();
  });

  it('policy evaluation failure fails closed: 503 POLICY_UNAVAILABLE, nothing persisted', async () => {
    const h = await harness();
    const open = await budget(h);
    const settings = h.client.repos.policySettings as unknown as {
      listCurrent: () => Promise<never>;
    };
    settings.listCurrent = async () => {
      throw new Error('policy store down');
    };
    const response = await submit(h, open);
    expect(response.statusCode).toBe(503);
    expect(response.json()).toMatchObject({ error: { code: 'POLICY_UNAVAILABLE' } });
    expect(await expenseCount(h)).toBe(0);
    await h.client.app.close();
  });

  it('RBAC still runs first: a role without expenses.create is 403 AUTHORIZATION_ERROR (policy never grants)', async () => {
    const client = await chatClient();
    const { organizationId, workspaceId } = await onboardOrgAndWorkspace(client);
    const response = await client.post('/api/finance/expenses', {
      organizationId,
      workspaceId,
      budgetId: 'bud_00000000-0000-4000-8000-000000000000',
      description: 'x',
      amountMinorUnits: 1_000,
      currency: 'INR',
    });
    // Engineering workspace -> CEO persona has no expenses.create.
    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({ error: { code: 'AUTHORIZATION_ERROR' } });
    await client.app.close();
  });
});
