/**
 * Finance vertical slice API tests (S35): budgets and expenses through the
 * REST surface (`fastify.inject`).
 *
 * Security contract under test: organization membership + workspace
 * membership are the FIRST authorization boundary (same as every other
 * vertical); the caller's effective RBAC capability — `budgets.read` /
 * `budgets.manage` / `expenses.read` / `expenses.create` / `expenses.decide`
 * — is the SECOND. This vertical slice grants every one of these
 * capabilities to `finance.cfo` only (platform/domains/src/seed/initial-
 * definitions.ts) — a real, single-owner vertical, not a company-wide read
 * like Calendar/Audit. A CEO (no Finance capabilities) must be rejected;
 * a member of workspace A must never read or mutate workspace B's records;
 * a foreign/forged tenant or workspace must never leak data.
 */

import { describe, expect, it } from 'vitest';

import {
  buildTestApp,
  chatClient,
  login,
  onboardOrgAndWorkspace,
  seedOrganizationMembership,
  seedWorkspaceMembership,
  type ChatClient,
} from './helpers.js';
import { FakeOidcGateway, MultiIdentityGateway } from './fakes.js';

/**
 * Onboards a `finance` workspace with TWO members that both resolve to
 * `finance.cfo` (the `finance` workspace type maps every membership role to
 * `finance.cfo`). `submitter` creates the budget and submits expenses;
 * `approver` is a distinct user who can decide them.
 */
async function cfoDecisionPair(): Promise<{
  submitter: ChatClient;
  approverCookie: string;
  approverId: string;
  organizationId: string;
  workspaceId: string;
}> {
  const { app, repos, store } = await buildTestApp({
    oidc: new MultiIdentityGateway([
      {
        subject: 'sub-cfo-submitter',
        email: 'submitter@nexora.dev',
        emailVerified: true,
        displayName: 'Sam Submitter',
        issuer: 'http://keycloak.test/realms/nexora',
      },
      {
        subject: 'sub-cfo-approver',
        email: 'approver@nexora.dev',
        emailVerified: true,
        displayName: 'Ada Approver',
        issuer: 'http://keycloak.test/realms/nexora',
      },
    ]),
  });

  const submitterCookie = await login(app);
  const approverCookie = await login(app);
  const submitter: ChatClient = {
    app,
    session: submitterCookie,
    store,
    repos,
    get: (path) => app.inject({ method: 'GET', url: path, headers: { cookie: submitterCookie } }),
    postEmpty: (path) =>
      app.inject({
        method: 'POST',
        url: path,
        headers: { cookie: submitterCookie, 'content-type': 'application/json' },
        payload: {},
      }),
    post: (path, body) =>
      app.inject({
        method: 'POST',
        url: path,
        headers: { cookie: submitterCookie, 'content-type': 'application/json' },
        payload: body,
      }),
    put: (path, body) =>
      app.inject({
        method: 'PUT',
        url: path,
        headers: { cookie: submitterCookie, 'content-type': 'application/json' },
        payload: body,
      }),
    patch: (path, body) =>
      app.inject({
        method: 'PATCH',
        url: path,
        headers: { cookie: submitterCookie, 'content-type': 'application/json' },
        payload: body,
      }),
  };

  const { organizationId, workspaceId } = await onboardOrgAndWorkspace(submitter, {
    workspaceType: 'finance',
  });

  const approverMe = await app.inject({
    method: 'GET',
    url: '/api/me',
    headers: { cookie: approverCookie },
  });
  const approverId = (approverMe.json() as { user: { id: string } }).user.id;

  // The approver joins the SAME organization + workspace as a member (which,
  // in a `finance` workspace, also resolves to `finance.cfo`).
  await seedOrganizationMembership(repos, {
    organizationId,
    userId: approverId,
    role: 'member',
  });
  await seedWorkspaceMembership(repos, {
    organizationId,
    workspaceId,
    userId: approverId,
    role: 'member',
  });

  return { submitter, approverCookie, approverId, organizationId, workspaceId };
}

/** A budget payload for creation. */
function budgetPayload(overrides: Record<string, unknown> = {}) {
  return {
    name: 'Engineering Q3 Budget',
    allocatedMinorUnits: 500_000,
    currency: 'INR',
    periodStart: '2026-07-01T00:00:00.000Z',
    periodEnd: '2026-09-30T00:00:00.000Z',
    ...overrides,
  };
}

/** Onboards a CFO-scoped client (the only role granted Finance capabilities). */
async function cfoClient(): Promise<{
  client: ChatClient;
  organizationId: string;
  workspaceId: string;
}> {
  const client = await chatClient();
  const { organizationId, workspaceId } = await onboardOrgAndWorkspace(client, {
    workspaceType: 'finance',
  });
  return { client, organizationId, workspaceId };
}

describe('Finance API — budgets', () => {
  it('creates, lists, and reads a budget in the authorized workspace', async () => {
    const { client, organizationId, workspaceId } = await cfoClient();

    const created = await client.post('/api/finance/budgets', {
      organizationId,
      workspaceId,
      ...budgetPayload(),
    });
    expect(created.statusCode).toBe(201);
    const budget = (created.json() as { budget: Record<string, unknown> }).budget;
    expect(budget.name).toBe('Engineering Q3 Budget');
    expect(budget.status).toBe('active');
    expect(budget.workspaceId).toBe(workspaceId);

    const listed = await client.get(
      `/api/finance/budgets?organizationId=${organizationId}&workspaceId=${workspaceId}`,
    );
    expect(listed.statusCode).toBe(200);
    expect((listed.json() as { budgets: unknown[] }).budgets).toHaveLength(1);

    const read = await client.get(
      `/api/finance/budgets/${budget.id}?organizationId=${organizationId}&workspaceId=${workspaceId}`,
    );
    expect(read.statusCode).toBe(200);
    expect((read.json() as { budget: { id: string } }).budget.id).toBe(budget.id);
  });

  it('rejects a malformed budget payload with 400 and no mutation', async () => {
    const { client, organizationId, workspaceId } = await cfoClient();
    const response = await client.post('/api/finance/budgets', {
      organizationId,
      workspaceId,
      ...budgetPayload({ name: '' }),
    });
    expect(response.statusCode).toBe(400);

    const listed = await client.get(
      `/api/finance/budgets?organizationId=${organizationId}&workspaceId=${workspaceId}`,
    );
    expect((listed.json() as { budgets: unknown[] }).budgets).toHaveLength(0);
  });

  it('revises a budget, then closes it (terminal — no further revision)', async () => {
    const { client, organizationId, workspaceId } = await cfoClient();
    const created = await client.post('/api/finance/budgets', {
      organizationId,
      workspaceId,
      ...budgetPayload(),
    });
    const budgetId = (created.json() as { budget: { id: string } }).budget.id;

    const revised = await client.patch(`/api/finance/budgets/${budgetId}`, {
      organizationId,
      workspaceId,
      ...budgetPayload({ name: 'Engineering Q3 Budget (revised)', allocatedMinorUnits: 600_000 }),
    });
    expect(revised.statusCode).toBe(200);
    expect((revised.json() as { budget: { name: string } }).budget.name).toBe(
      'Engineering Q3 Budget (revised)',
    );

    const closed = await client.post(`/api/finance/budgets/${budgetId}/close`, {
      organizationId,
      workspaceId,
    });
    expect(closed.statusCode).toBe(200);
    expect((closed.json() as { budget: { status: string } }).budget.status).toBe('closed');

    // A closed budget cannot be revised (422 business rule).
    const lateRevision = await client.patch(`/api/finance/budgets/${budgetId}`, {
      organizationId,
      workspaceId,
      ...budgetPayload({ name: 'Too late' }),
    });
    expect(lateRevision.statusCode).toBe(422);
  });

  it('returns 404 for an unknown budget id', async () => {
    const { client, organizationId, workspaceId } = await cfoClient();
    const response = await client.get(
      `/api/finance/budgets/bud_00000000-0000-4000-8000-000000000000?organizationId=${organizationId}&workspaceId=${workspaceId}`,
    );
    expect(response.statusCode).toBe(404);
  });
});

describe('Finance API — expenses', () => {
  async function createOpenBudget(
    client: ChatClient,
    organizationId: string,
    workspaceId: string,
  ): Promise<string> {
    const created = await client.post('/api/finance/budgets', {
      organizationId,
      workspaceId,
      ...budgetPayload(),
    });
    return (created.json() as { budget: { id: string } }).budget.id;
  }

  it('submitter submits, a DIFFERENT approver approves it (terminal — counts as spend)', async () => {
    const { submitter, approverCookie, organizationId, workspaceId } = await cfoDecisionPair();
    const budgetId = await createOpenBudget(submitter, organizationId, workspaceId);

    const submitted = await submitter.post('/api/finance/expenses', {
      organizationId,
      workspaceId,
      budgetId,
      description: 'Conference travel',
      amountMinorUnits: 25_000,
      currency: 'INR',
    });
    expect(submitted.statusCode).toBe(201);
    const expense = (submitted.json() as { expense: Record<string, unknown> }).expense;
    expect(expense.status).toBe('pending');

    // Segregation of duties (PRD §14.3.3, FR-21): the submitter cannot
    // approve their own expense even though `finance.cfo` holds
    // `expenses.decide` — the aggregate refuses it (422 business rule).
    const selfApproved = await submitter.post(`/api/finance/expenses/${expense.id}/decide`, {
      organizationId,
      workspaceId,
      decision: 'approve',
    });
    expect(selfApproved.statusCode).toBe(422);

    // A different CFO-scoped user approves it.
    const decided = await submitter.app.inject({
      method: 'POST',
      url: `/api/finance/expenses/${expense.id}/decide`,
      headers: { cookie: approverCookie, 'content-type': 'application/json' },
      payload: { organizationId, workspaceId, decision: 'approve' },
    });
    expect(decided.statusCode).toBe(200);
    expect((decided.json() as { expense: { status: string } }).expense.status).toBe('approved');

    // A decided expense cannot be decided again (422 business rule — a
    // decision is never revised, same integrity rule as a ledger entry).
    const redecided = await submitter.app.inject({
      method: 'POST',
      url: `/api/finance/expenses/${expense.id}/decide`,
      headers: { cookie: approverCookie, 'content-type': 'application/json' },
      payload: { organizationId, workspaceId, decision: 'reject' },
    });
    expect(redecided.statusCode).toBe(422);

    const utilization = await submitter.get(
      `/api/finance/budgets/utilization?organizationId=${organizationId}&workspaceId=${workspaceId}`,
    );
    expect(utilization.statusCode).toBe(200);
    const entry = (
      utilization.json() as { utilization: { budgetId: string; spentMinorUnits: number }[] }
    ).utilization.find((u) => u.budgetId === budgetId);
    expect(entry?.spentMinorUnits).toBe(25_000);
  });

  it('rejects an expense against a nonexistent budget with 404 and no mutation', async () => {
    const { client, organizationId, workspaceId } = await cfoClient();
    const response = await client.post('/api/finance/expenses', {
      organizationId,
      workspaceId,
      budgetId: 'bud_00000000-0000-4000-8000-000000000000',
      description: 'Ghost expense',
      amountMinorUnits: 1_000,
      currency: 'INR',
    });
    expect(response.statusCode).toBe(404);

    const listed = await client.get(
      `/api/finance/expenses?organizationId=${organizationId}&workspaceId=${workspaceId}`,
    );
    expect((listed.json() as { expenses: unknown[] }).expenses).toHaveLength(0);
  });

  it('rejects an expense against a closed budget', async () => {
    const { client, organizationId, workspaceId } = await cfoClient();
    const budgetId = await createOpenBudget(client, organizationId, workspaceId);
    await client.post(`/api/finance/budgets/${budgetId}/close`, { organizationId, workspaceId });

    const response = await client.post('/api/finance/expenses', {
      organizationId,
      workspaceId,
      budgetId,
      description: 'Late claim',
      amountMinorUnits: 1_000,
      currency: 'INR',
    });
    // Prompt 8: the central policy (origin `rest`) denies it before the domain
    // is consulted — a direct human REST call is never a way around a DENY.
    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({
      error: { code: 'POLICY_DENIED', policy: { policyId: 'POLICY_FINANCE_BUDGET_STATE' } },
    });
  });

  it('rejects an expense in a currency other than the budget currency (422, nothing stored)', async () => {
    const { client, organizationId, workspaceId } = await cfoClient();
    const budgetId = await createOpenBudget(client, organizationId, workspaceId);
    const mismatch = await client.post('/api/finance/expenses', {
      organizationId,
      workspaceId,
      budgetId,
      description: 'Foreign-currency claim',
      amountMinorUnits: 1_000,
      currency: 'USD',
    });
    expect(mismatch.statusCode).toBe(422);
    const listed = await client.get(
      `/api/finance/expenses?organizationId=${organizationId}&workspaceId=${workspaceId}`,
    );
    expect((listed.json() as { expenses: unknown[] }).expenses).toHaveLength(0);
    // Control: the same claim in the budget currency is accepted.
    const accepted = await client.post('/api/finance/expenses', {
      organizationId,
      workspaceId,
      budgetId,
      description: 'Foreign-currency claim',
      amountMinorUnits: 1_000,
      currency: 'INR',
    });
    expect(accepted.statusCode).toBe(201);
  });

  it('a budget closed after submission cannot receive the approval (refused, spend unchanged); control: an open budget approves', async () => {
    const { submitter, approverCookie, organizationId, workspaceId } = await cfoDecisionPair();
    const decideAsApprover = (expenseId: string) =>
      submitter.app.inject({
        method: 'POST',
        url: `/api/finance/expenses/${expenseId}/decide`,
        headers: { cookie: approverCookie, 'content-type': 'application/json' },
        payload: { organizationId, workspaceId, decision: 'approve' },
      });
    const submit = async (budgetId: string, amountMinorUnits: number) =>
      (
        (
          await submitter.post('/api/finance/expenses', {
            organizationId,
            workspaceId,
            budgetId,
            description: 'Travel',
            amountMinorUnits,
            currency: 'INR',
          })
        ).json() as { expense: { id: string } }
      ).expense.id;
    const spentOf = async (budgetId: string) => {
      const utilization = await submitter.get(
        `/api/finance/budgets/utilization?organizationId=${organizationId}&workspaceId=${workspaceId}`,
      );
      return (
        utilization.json() as { utilization: { budgetId: string; spentMinorUnits: number }[] }
      ).utilization.find((u) => u.budgetId === budgetId)?.spentMinorUnits;
    };

    const openBudgetId = await createOpenBudget(submitter, organizationId, workspaceId);
    const closedBudgetId = await createOpenBudget(submitter, organizationId, workspaceId);
    const openExpense = await submit(openBudgetId, 7_000);
    const lateExpense = await submit(closedBudgetId, 9_000);
    await submitter.post(`/api/finance/budgets/${closedBudgetId}/close`, {
      organizationId,
      workspaceId,
    });

    const refused = await decideAsApprover(lateExpense);
    expect([403, 422]).toContain(refused.statusCode);
    expect(await spentOf(closedBudgetId)).toBe(0);

    // Control: the expense on the still-open budget is approved and equals the utilization delta.
    const before = await spentOf(openBudgetId);
    const approved = await decideAsApprover(openExpense);
    expect(approved.statusCode).toBe(200);
    expect(
      (approved.json() as { expense: { amountMinorUnits: number } }).expense.amountMinorUnits,
    ).toBe(7_000);
    expect(((await spentOf(openBudgetId)) ?? 0) - (before ?? 0)).toBe(7_000);
  });

  it('a rejected expense never counts as spend', async () => {
    const { client, organizationId, workspaceId } = await cfoClient();
    const budgetId = await createOpenBudget(client, organizationId, workspaceId);
    const submitted = await client.post('/api/finance/expenses', {
      organizationId,
      workspaceId,
      budgetId,
      description: 'Declined claim',
      amountMinorUnits: 40_000,
      currency: 'INR',
    });
    const expenseId = (submitted.json() as { expense: { id: string } }).expense.id;
    const decided = await client.post(`/api/finance/expenses/${expenseId}/decide`, {
      organizationId,
      workspaceId,
      decision: 'reject',
    });
    expect((decided.json() as { expense: { status: string } }).expense.status).toBe('rejected');

    const utilization = await client.get(
      `/api/finance/budgets/utilization?organizationId=${organizationId}&workspaceId=${workspaceId}`,
    );
    const entry = (
      utilization.json() as { utilization: { budgetId: string; spentMinorUnits: number }[] }
    ).utilization.find((u) => u.budgetId === budgetId);
    expect(entry?.spentMinorUnits).toBe(0);
  });
});

describe('Finance API — authorization boundaries', () => {
  it('an HR Manager (no Finance capabilities) is rejected with 403 on every write and read', async () => {
    const client = await chatClient();
    // An `hr` workspace resolves its owner to people.hr, which holds no finance capability.
    const { organizationId, workspaceId } = await onboardOrgAndWorkspace(client, {
      workspaceType: 'hr',
    });

    const createDenied = await client.post('/api/finance/budgets', {
      organizationId,
      workspaceId,
      ...budgetPayload(),
    });
    expect(createDenied.statusCode).toBe(403);
    expect(createDenied.json()).toMatchObject({ error: { code: 'AUTHORIZATION_ERROR' } });

    const readDenied = await client.get(
      `/api/finance/budgets?organizationId=${organizationId}&workspaceId=${workspaceId}`,
    );
    expect(readDenied.statusCode).toBe(403);

    const expenseDenied = await client.post('/api/finance/expenses', {
      organizationId,
      workspaceId,
      budgetId: 'bud_00000000-0000-4000-8000-000000000000',
      description: 'Attempted claim',
      amountMinorUnits: 1_000,
      currency: 'INR',
    });
    expect(expenseDenied.statusCode).toBe(403);
  });

  it('rejects a forged organization scope with 403', async () => {
    const { client, workspaceId } = await cfoClient();
    const response = await client.post('/api/finance/budgets', {
      organizationId: 'org_alien_0000',
      workspaceId,
      ...budgetPayload(),
    });
    expect(response.statusCode).toBe(403);
  });

  it('rejects a non-member workspace scope with 403', async () => {
    const { client, organizationId } = await cfoClient();
    const response = await client.post('/api/finance/budgets', {
      organizationId,
      workspaceId: 'ws_alien_0000',
      ...budgetPayload(),
    });
    expect(response.statusCode).toBe(403);
  });

  it('a member of one CFO workspace cannot read another workspace’s budgets (403)', async () => {
    const { app, repos } = await buildTestApp({ oidc: new FakeOidcGateway() });
    const session = await login(app);
    const client: ChatClient = {
      app,
      session,
      store: null as never,
      repos,
      get(path) {
        return app.inject({ method: 'GET', url: path, headers: { cookie: session } });
      },
      post(path, body) {
        return app.inject({
          method: 'POST',
          url: path,
          headers: { cookie: session, 'content-type': 'application/json' },
          payload: body,
        });
      },
      put(path, body) {
        return app.inject({
          method: 'PUT',
          url: path,
          headers: { cookie: session, 'content-type': 'application/json' },
          payload: body,
        });
      },
      patch(path, body) {
        return app.inject({
          method: 'PATCH',
          url: path,
          headers: { cookie: session, 'content-type': 'application/json' },
          payload: body,
        });
      },
      postEmpty(path) {
        return app.inject({
          method: 'POST',
          url: path,
          headers: { cookie: session, 'content-type': 'application/json' },
          payload: {},
        });
      },
    };
    const { organizationId, workspaceId } = await onboardOrgAndWorkspace(client, {
      workspaceType: 'finance',
    });
    const created = await client.post('/api/finance/budgets', {
      organizationId,
      workspaceId,
      ...budgetPayload(),
    });
    const budgetId = (created.json() as { budget: { id: string } }).budget.id;

    // A forged cross-workspace read (same org, foreign workspace) → 403.
    const forged = await client.get(
      `/api/finance/budgets/${budgetId}?organizationId=${organizationId}&workspaceId=ws_alien_0000`,
    );
    expect(forged.statusCode).toBe(403);
  });

  it('a real CFO of one tenant cannot read the budgets of a foreign tenant', async () => {
    const first = await cfoClient();
    const second = await cfoClient();
    await first.client.post('/api/finance/budgets', {
      organizationId: first.organizationId,
      workspaceId: first.workspaceId,
      ...budgetPayload(),
    });

    // Second CFO's own client, but pointed at the FIRST tenant's scope — the
    // second client is not a member there, so scope check fails closed.
    const crossTenant = await second.client.get(
      `/api/finance/budgets?organizationId=${first.organizationId}&workspaceId=${first.workspaceId}`,
    );
    expect(crossTenant.statusCode).toBe(403);
  });

  it('rejects unauthenticated access with 401', async () => {
    const { app } = await buildTestApp({ oidc: new FakeOidcGateway() });
    const response = await app.inject({
      method: 'GET',
      url: '/api/finance/budgets?organizationId=org_x&workspaceId=ws_x',
    });
    expect(response.statusCode).toBe(401);
  });
});
