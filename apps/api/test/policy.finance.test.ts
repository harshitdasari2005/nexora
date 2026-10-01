/**
 * Finance policy (Prompt 5) through the REAL paths: `POST /api/ai/chat`,
 * `POST /api/ai/approvals/:id/decision` and governed agent runs, over the
 * real PolicyEngine, ApiPolicyPort, ToolExecutor and orchestrator (only the
 * repositories are in-memory fakes). Every DENY case has a paired positive
 * control that differs by exactly one factor.
 *
 * Harness notes:
 *  - The chat user is the creator of a `finance` workspace, which resolves to
 *    `finance.cfo` (holds expenses.create / budgets.*). The audit trail needs
 *    `audit.read`, which that role lacks, so the same user also owns an
 *    `engineering` workspace (CEO) and reads the audit trail through it (the
 *    audit scope anchor is the caller's own workspace; data is tenant-wide).
 *  - Organization policy configuration is appended through the app's
 *    `policySettings` repository, reachable as `client.repos.policySettings`.
 */

import { describe, expect, it } from 'vitest';

import { extractSubmitExpenseParameters } from '../src/ai/parameters.js';
import { InMemoryPolicySettingsRepository } from '../src/policy/policy-settings.js';
import {
  chatClient,
  currentUserId,
  onboardOrgAndWorkspace,
  parseSse,
  provisionAgent,
} from './helpers.js';
import type { ChatClient } from './helpers.js';

const LIMIT = 'POLICY_FINANCE_BUDGET_LIMIT';
const EXPENSE_APPROVAL = 'POLICY_FINANCE_EXPENSE_APPROVAL';
const BUDGET_STATE = 'POLICY_FINANCE_BUDGET_STATE';

interface DonePayload {
  status: string;
  response: string;
  steps: { stepId: string; toolId: string; status: string; errorCode?: string }[];
  approvals: { id?: string; status: string; toolId: string; input?: Record<string, unknown> }[];
}

interface AuditEvent {
  id: string;
  source: string;
  status: string;
  detail?: string;
  policy?: { id: string; version: string; outcome: string; rules: readonly string[] };
}

interface Harness {
  client: ChatClient;
  organizationId: string;
  /** The finance workspace (finance.cfo) the chat runs in. */
  workspaceId: string;
  /** The engineering workspace (CEO) used as the audit scope anchor. */
  auditWorkspaceId: string;
}

async function harness(): Promise<Harness> {
  const client = await chatClient();
  const { organizationId, workspaceId: auditWorkspaceId } = await onboardOrgAndWorkspace(client);
  const created = await client.post('/api/workspaces', {
    organizationId,
    name: 'Finance',
    slug: 'finance',
    type: 'finance',
  });
  expect(created.statusCode).toBe(201);
  const workspaceId = (created.json() as { workspace: { id: string } }).workspace.id;
  return { client, organizationId, workspaceId, auditWorkspaceId };
}

async function createBudget(
  h: Harness,
  options: {
    allocatedMinorUnits?: number;
    currency?: string;
    closed?: boolean;
    organizationId?: string;
    workspaceId?: string;
    client?: ChatClient;
  } = {},
): Promise<string> {
  const client = options.client ?? h.client;
  const organizationId = options.organizationId ?? h.organizationId;
  const workspaceId = options.workspaceId ?? h.workspaceId;
  const response = await client.post('/api/finance/budgets', {
    organizationId,
    workspaceId,
    name: 'Ops budget',
    allocatedMinorUnits: options.allocatedMinorUnits ?? 500_000,
    currency: options.currency ?? 'INR',
    periodStart: '2026-07-01T00:00:00.000Z',
    periodEnd: '2026-09-30T00:00:00.000Z',
  });
  expect(response.statusCode).toBe(201);
  const budgetId = (response.json() as { budget: { id: string } }).budget.id;
  if (options.closed === true) {
    const closed = await client.post(`/api/finance/budgets/${budgetId}/close`, {
      organizationId,
      workspaceId,
    });
    expect(closed.statusCode).toBe(200);
  }
  return budgetId;
}

function expenseMessage(budgetId: string, amount = '1,000', currency = 'INR'): string {
  return `Submit an expense of ${amount} ${currency} for team offsite against budget ${budgetId}`;
}

function doneOf(body: string): DonePayload {
  return parseSse(body).find((event) => event.event === 'done')?.data as DonePayload;
}

async function chatExpense(h: Harness, budgetId: string, amount = '1,000', currency = 'INR') {
  const raw = await h.client.post('/api/ai/chat', {
    message: expenseMessage(budgetId, amount, currency),
    workspaceId: h.workspaceId,
  });
  expect(raw.statusCode).toBe(200);
  return doneOf(raw.body);
}

async function decide(h: Harness, approvalId: string) {
  const response = await h.client.post(`/api/ai/approvals/${approvalId}/decision`, {
    decision: 'approve',
  });
  expect(response.statusCode).toBe(200);
  return doneOf(response.body);
}

function expenses(h: Harness) {
  return [
    ...(h.client.repos.expenses as unknown as { expenses: Map<string, unknown> }).expenses.values(),
  ] as { amount: { minorUnits: number; currency: string }; budgetId: string }[];
}

async function audit(h: Harness, filters: string): Promise<AuditEvent[]> {
  const response = await h.client.get(
    `/api/audit/events?organizationId=${h.organizationId}&workspaceId=${h.auditWorkspaceId}&${filters}`,
  );
  expect(response.statusCode).toBe(200);
  return (response.json() as { events: AuditEvent[] }).events;
}

async function approvalEvents(h: Harness): Promise<AuditEvent[]> {
  return (await audit(h, 'source=approval')).filter((event) => event.source === 'approval');
}

async function blockedEvents(h: Harness): Promise<AuditEvent[]> {
  return (await audit(h, 'source=activity&status=blocked')).filter(
    (event) => event.source === 'activity' && event.status === 'blocked',
  );
}

async function setLimit(h: Harness, config: unknown): Promise<void> {
  await h.client.repos.policySettings?.append({
    organizationId: h.organizationId,
    policyId: LIMIT,
    config,
    createdBy: currentUserId(h.client),
  });
}

function expectGated(done: DonePayload): string {
  expect(done.status).toBe('blocked');
  expect(done.steps[0]).toMatchObject({ toolId: 'finance.submit_expense', status: 'blocked' });
  expect(done.approvals[0]?.status).toBe('pending');
  const id = done.approvals[0]?.id;
  expect(id).toMatch(/^apr_/);
  return id as string;
}

/** The approved expense step ran (the plan's follow-up step has its own gate). */
function expectExecuted(done: DonePayload): void {
  expect(done.steps[0]).toMatchObject({ toolId: 'finance.submit_expense', status: 'succeeded' });
}

function expectDenied(done: DonePayload): void {
  expect(done.status).toBe('failed');
  expect(done.steps[0]).toMatchObject({
    toolId: 'finance.submit_expense',
    status: 'failed',
    errorCode: 'POLICY_DENIED',
  });
  expect(done.approvals).toEqual([]);
}

describe('finance policy — expense approval gate (chat path)', () => {
  it('active budget: gate opens under POLICY_FINANCE_EXPENSE_APPROVAL@1, approving executes exactly once', async () => {
    const h = await harness();
    const budgetId = await createBudget(h);

    const done = await chatExpense(h, budgetId);
    const approvalId = expectGated(done);
    expect(done.approvals[0]?.input).toMatchObject({
      amountMinorUnits: 100_000,
      currency: 'INR',
      budgetId,
    });
    expect(expenses(h)).toHaveLength(0);

    const [event] = await approvalEvents(h);
    expect(event?.policy).toMatchObject({
      id: EXPENSE_APPROVAL,
      version: '1',
      outcome: 'REQUIRE_APPROVAL',
    });
    expect(event?.policy?.rules).toContain(`${EXPENSE_APPROVAL}@1=REQUIRE_APPROVAL`);
    expect(event?.status).toBe('awaiting_approval');

    const executed = await decide(h, approvalId);
    expectExecuted(executed);
    expect(executed.steps[0]).toMatchObject({
      toolId: 'finance.submit_expense',
      status: 'succeeded',
    });
    expect(expenses(h)).toHaveLength(1);
    expect(expenses(h)[0]).toMatchObject({
      budgetId,
      amount: { minorUnits: 100_000, currency: 'INR' },
    });

    // Exactly once: a second decision is refused and creates nothing.
    const again = await h.client.post(`/api/ai/approvals/${approvalId}/decision`, {
      decision: 'approve',
    });
    expect(again.statusCode).toBe(409);
    expect(expenses(h)).toHaveLength(1);
    await h.client.app.close();
  });

  it('closed budget: POLICY_DENIED before any approval, no expense (active budget is the control)', async () => {
    const h = await harness();
    const closedId = await createBudget(h, { closed: true });
    const activeId = await createBudget(h);

    const denied = await chatExpense(h, closedId);
    expectDenied(denied);
    expect(expenses(h)).toHaveLength(0);
    expect(await approvalEvents(h)).toHaveLength(0);
    const blocked = await blockedEvents(h);
    const denial = blocked.find((event) => event.policy?.id === BUDGET_STATE);
    expect(denial?.policy?.outcome).toBe('DENY');
    expect(denial?.policy?.rules).toContain(`${BUDGET_STATE}@1=DENY`);
    expect(denial?.detail).toContain('closed budget');

    // Control: identical request against an active budget opens the gate.
    expectGated(await chatExpense(h, activeId));
    expect(await approvalEvents(h)).toHaveLength(1);
    expect(expenses(h)).toHaveLength(0);
    await h.client.app.close();
  });

  it('missing, other-workspace and other-tenant budgets are denied identically (no oracle)', async () => {
    const h = await harness();
    const own = await createBudget(h);

    // Another workspace of the SAME tenant.
    const other = await h.client.post('/api/workspaces', {
      organizationId: h.organizationId,
      name: 'Ops Finance',
      slug: 'ops-finance',
      type: 'finance',
    });
    const otherWorkspaceId = (other.json() as { workspace: { id: string } }).workspace.id;
    const foreignWorkspaceBudget = await createBudget(h, { workspaceId: otherWorkspaceId });

    // Another TENANT (a second organization of the same user).
    const org2 = await h.client.post('/api/organizations', {
      name: 'Two',
      slug: 'two',
      type: 'startup',
    });
    expect(org2.statusCode).toBe(201);
    const org2Id = (org2.json() as { organization: { id: string } }).organization.id;
    const ws2 = await h.client.post('/api/workspaces', {
      organizationId: org2Id,
      name: 'Finance',
      slug: 'finance',
      type: 'finance',
    });
    const ws2Id = (ws2.json() as { workspace: { id: string } }).workspace.id;
    const foreignTenantBudget = await createBudget(h, {
      organizationId: org2Id,
      workspaceId: ws2Id,
    });

    const missing = 'bud_00000000-0000-4000-8000-000000000000';
    const results: Record<string, DonePayload> = {};
    for (const [label, id] of [
      ['missing', missing],
      ['foreignWorkspace', foreignWorkspaceBudget],
      ['foreignTenant', foreignTenantBudget],
    ] as const) {
      results[label] = await chatExpense(h, id);
      expectDenied(results[label] as DonePayload);
    }
    // Same outward shape: only the (user-supplied) budget id inside the echoed
    // intent differs — nothing distinguishes missing from foreign.
    const normalise = (done: DonePayload, id: string) =>
      JSON.parse(JSON.stringify(done).split(id).join('<BUDGET>')) as unknown;
    const shape = normalise(results['missing'] as DonePayload, missing) as Record<string, unknown>;
    const strip = (value: Record<string, unknown>) => {
      const { conversationId: _c, ...rest } = value;
      void _c;
      return rest;
    };
    expect(
      strip(
        normalise(results['foreignWorkspace'] as DonePayload, foreignWorkspaceBudget) as Record<
          string,
          unknown
        >,
      ),
    ).toEqual(strip(shape));
    expect(
      strip(
        normalise(results['foreignTenant'] as DonePayload, foreignTenantBudget) as Record<
          string,
          unknown
        >,
      ),
    ).toEqual(strip(shape));
    expect(expenses(h)).toHaveLength(0);
    expect(await approvalEvents(h)).toHaveLength(0);
    // The audit trail records the same denial reason for all three.
    const denials = (await blockedEvents(h)).filter((event) => event.policy?.id === BUDGET_STATE);
    expect(denials).toHaveLength(3);
    const ids = [missing, foreignWorkspaceBudget, foreignTenantBudget];
    const details = denials.map((event) =>
      ids
        .reduce((text, id) => text.split(id).join('<BUDGET>'), event.detail ?? '')
        .replace(/invocation: \S+/, 'invocation: <RUN>'),
    );
    expect(new Set(details).size).toBe(1);

    // Control: the caller's own budget in the trusted workspace is gated.
    expectGated(await chatExpense(h, own));
    await h.client.app.close();
  });
});

describe('finance policy — POLICY_FINANCE_BUDGET_LIMIT (opt-in, per organization)', () => {
  it('deny mode: overrun is denied; a within-budget expense is still gated (with the limit rule recorded)', async () => {
    const h = await harness();
    const budgetId = await createBudget(h, { allocatedMinorUnits: 500_000 });

    // Control (no config): the overrun is only gated, not denied.
    expectGated(await chatExpense(h, budgetId, '6,000'));

    await setLimit(h, { mode: 'deny' });

    expectDenied(await chatExpense(h, budgetId, '6,000'));
    const denial = (await blockedEvents(h)).find((event) => event.policy?.id === LIMIT);
    expect(denial?.policy).toMatchObject({ id: LIMIT, version: '1+config.1', outcome: 'DENY' });
    expect(expenses(h)).toHaveLength(0);

    const within = await chatExpense(h, budgetId, '1,000');
    expectGated(within);
    const events = await approvalEvents(h);
    const latest = events.find((event) =>
      event.policy?.rules.includes(`${LIMIT}@1+config.1=ALLOW`),
    );
    expect(latest?.policy?.id).toBe(EXPENSE_APPROVAL);
    expect(expenses(h)).toHaveLength(0);
    await h.client.app.close();
  });

  it("another organization's configuration never applies (tenant-scoped)", async () => {
    const h = await harness();
    const budgetId = await createBudget(h);
    await h.client.repos.policySettings?.append({
      organizationId: 'org_someone_else',
      policyId: LIMIT,
      config: { mode: 'deny' },
      createdBy: 'usr_other',
    });
    expectGated(await chatExpense(h, budgetId, '6,000'));
    await setLimit(h, { mode: 'deny' });
    expectDenied(await chatExpense(h, budgetId, '6,000'));
    await h.client.app.close();
  });

  it('require_approval mode: overrun is still gated, not denied', async () => {
    const h = await harness();
    const budgetId = await createBudget(h, { allocatedMinorUnits: 500_000 });
    await setLimit(h, { mode: 'require_approval' });

    const done = await chatExpense(h, budgetId, '6,000');
    expectGated(done);
    expect(
      (await blockedEvents(h)).filter((event) => event.policy?.outcome === 'DENY'),
    ).toHaveLength(0);
    const [event] = await approvalEvents(h);
    expect(event?.policy?.rules).toContain(`${LIMIT}@1+config.1=REQUIRE_APPROVAL`);
    expect(expenses(h)).toHaveLength(0);
    await h.client.app.close();
  });

  it('invalid configuration fails closed (valid configuration is the control)', async () => {
    const h = await harness();
    const budgetId = await createBudget(h);

    await setLimit(h, { mode: 'bogus' });
    expectDenied(await chatExpense(h, budgetId, '1,000'));
    const denial = (await blockedEvents(h)).find((event) => event.policy?.id === LIMIT);
    expect(denial?.policy?.version).toBe('1+config.1');
    expect(denial?.detail).toContain('configuration is invalid');

    await setLimit(h, 'deny'); // not an object: still invalid
    expectDenied(await chatExpense(h, budgetId, '1,000'));

    await setLimit(h, { mode: 'deny' }); // control: v3 is valid, within budget => gated
    expectGated(await chatExpense(h, budgetId, '1,000'));
    expect(expenses(h)).toHaveLength(0);
    await h.client.app.close();
  });

  it('currency mismatch is denied when the limit policy is configured (not otherwise; matching currency is the control)', async () => {
    const h = await harness();
    const budgetId = await createBudget(h, { currency: 'INR' });

    // No configuration: the mismatch is not this policy's concern.
    expectGated(await chatExpense(h, budgetId, '10', 'USD'));

    await setLimit(h, { mode: 'require_approval' });
    expectDenied(await chatExpense(h, budgetId, '10', 'USD'));
    const denial = (await blockedEvents(h)).find((event) => event.policy?.id === LIMIT);
    expect(denial?.policy?.outcome).toBe('DENY');

    // Control: same amount in the budget currency is gated.
    expectGated(await chatExpense(h, budgetId, '10', 'INR'));
    expect(expenses(h)).toHaveLength(0);
    await h.client.app.close();
  });

  it('config changed AFTER the approval opened: resume returns POLICY_CHANGED_AFTER_APPROVAL, no expense', async () => {
    const h = await harness();
    const budgetId = await createBudget(h);

    // Control: no change between request and approval => executes.
    const controlId = expectGated(await chatExpense(h, budgetId, '1,000'));
    expectExecuted(await decide(h, controlId));
    expect(expenses(h)).toHaveLength(1);

    // Changed: the approval is opened under fingerprint F1, then the org opts in.
    const approvalId = expectGated(await chatExpense(h, budgetId, '2,000'));
    await setLimit(h, { mode: 'require_approval' });
    const resumed = await decide(h, approvalId);
    expect(resumed.status).toBe('failed');
    expect(resumed.steps[0]).toMatchObject({
      status: 'failed',
      errorCode: 'POLICY_CHANGED_AFTER_APPROVAL',
    });
    expect(expenses(h)).toHaveLength(1);

    // Requesting again opens a fresh approval under the current policy, which executes.
    const fresh = expectGated(await chatExpense(h, budgetId, '2,000'));
    expectExecuted(await decide(h, fresh));
    expect(expenses(h)).toHaveLength(2);
    await h.client.app.close();
  });

  it('a config change to deny after approval opened blocks execution (POLICY_DENIED) for an overrun', async () => {
    const h = await harness();
    const budgetId = await createBudget(h, { allocatedMinorUnits: 500_000 });
    // Control: an overrun approval with no config change executes.
    const controlId = expectGated(await chatExpense(h, budgetId, '6,000'));
    expectExecuted(await decide(h, controlId));
    expect(expenses(h)).toHaveLength(1);
    const approvalId = expectGated(await chatExpense(h, budgetId, '6,000'));
    await setLimit(h, { mode: 'deny' });
    const resumed = await decide(h, approvalId);
    expect(resumed.status).toBe('failed');
    expect(resumed.steps[0]?.errorCode).toBe('POLICY_DENIED');
    expect(expenses(h)).toHaveLength(1);
    await h.client.app.close();
  });
});

describe('finance policy — agent runs', () => {
  async function financeAgent(h: Harness): Promise<string> {
    const { agentId } = await provisionAgent(h.client.repos, {
      organizationId: h.organizationId,
      workspaceId: h.workspaceId,
      definitionId: 'finance',
      grantedBy: currentUserId(h.client),
      capabilityIds: ['finance.submit_expense'],
    });
    return agentId;
  }

  async function run(h: Harness, agentId: string, budgetId: string) {
    const response = await h.client.post(
      `/api/agents/${agentId}/execute?organizationId=${h.organizationId}&workspaceId=${h.workspaceId}`,
      { utterance: expenseMessage(budgetId) },
    );
    expect(response.statusCode).toBe(200);
    return (
      response.json() as {
        outcome: {
          status: string;
          steps: { toolId: string; status: string; errorCode?: string; error?: string }[];
          approvals: { id?: string; status: string }[];
        };
      }
    ).outcome;
  }

  it('agent run: active budget opens the gate, approval executes once; closed budget is denied before any approval', async () => {
    const h = await harness();
    const agentId = await financeAgent(h);
    const active = await createBudget(h);
    const closed = await createBudget(h, { closed: true });

    const denied = await run(h, agentId, closed);
    expect(denied.status).not.toBe('blocked');
    expect(denied.steps[0]).toMatchObject({
      toolId: 'finance.submit_expense',
      status: 'failed',
      errorCode: 'POLICY_DENIED',
    });
    expect(denied.approvals).toEqual([]);
    expect(expenses(h)).toHaveLength(0);
    expect(await approvalEvents(h)).toHaveLength(0);

    const gated = await run(h, agentId, active);
    expect(gated.status).toBe('blocked');
    expect(gated.steps[0]?.status).toBe('blocked');
    expect(gated.approvals[0]?.status).toBe('pending');
    expect(expenses(h)).toHaveLength(0);
    const [event] = await approvalEvents(h);
    expect(event?.policy?.id).toBe(EXPENSE_APPROVAL);

    const executed = await decide(h, gated.approvals[0]?.id as string);
    expectExecuted(executed);
    expect(expenses(h)).toHaveLength(1);
    expect(expenses(h)[0]?.amount.minorUnits).toBe(100_000);
    await h.client.app.close();
  });

  it('agent run: org deny-mode limit denies an overrun; a config change after approval blocks the resume', async () => {
    const h = await harness();
    const agentId = await financeAgent(h);
    const budgetId = await createBudget(h);

    const first = await run(h, agentId, budgetId);
    expect(first.status).toBe('blocked');
    await setLimit(h, { mode: 'require_approval' });
    const resumed = await decide(h, first.approvals[0]?.id as string);
    expect(resumed.steps[0]?.errorCode).toBe('POLICY_CHANGED_AFTER_APPROVAL');
    expect(expenses(h)).toHaveLength(0);

    await setLimit(h, { mode: 'deny' });
    const response = await h.client.post(
      `/api/agents/${agentId}/execute?organizationId=${h.organizationId}&workspaceId=${h.workspaceId}`,
      { utterance: expenseMessage(budgetId, '6,000') },
    );
    const outcome = (
      response.json() as {
        outcome: { steps: { status: string; errorCode?: string }[]; approvals: unknown[] };
      }
    ).outcome;
    expect(outcome.steps[0]).toMatchObject({ status: 'failed', errorCode: 'POLICY_DENIED' });
    expect(outcome.approvals).toEqual([]);
    expect(expenses(h)).toHaveLength(0);

    // Control: same deny-mode config, within-budget amount => still gated.
    const within = await run(h, agentId, budgetId);
    expect(within.status).toBe('blocked');
    expect(within.approvals[0]?.status).toBe('pending');
    expect(expenses(h)).toHaveLength(0);
    await h.client.app.close();
  });
});

describe('extractSubmitExpenseParameters', () => {
  it('extracts amount, currency, budget and description (minor units)', () => {
    expect(
      extractSubmitExpenseParameters(
        'Submit an expense of 1,000 INR for team offsite against budget bud_abc-1',
      ),
    ).toEqual({
      amountMinorUnits: 100_000,
      currency: 'INR',
      budgetId: 'bud_abc-1',
      description: 'team offsite',
    });
  });

  it('handles symbols and fractional amounts as minor units', () => {
    expect(extractSubmitExpenseParameters('Submit an expense of $12.50 for lunch')).toMatchObject({
      amountMinorUnits: 1_250,
      currency: 'USD',
      description: 'lunch',
    });
    expect(
      extractSubmitExpenseParameters('Submit an expense of ₹4,500 for the Q3 campaign'),
    ).toMatchObject({
      amountMinorUnits: 450_000,
      currency: 'INR',
    });
    expect(extractSubmitExpenseParameters('expense of €20 for train')).toMatchObject({
      amountMinorUnits: 2_000,
      currency: 'EUR',
    });
    expect(extractSubmitExpenseParameters('expense of 3 gbp for tea')).toMatchObject({
      amountMinorUnits: 300,
      currency: 'GBP',
    });
  });

  it('omits whatever the utterance does not state', () => {
    expect(extractSubmitExpenseParameters('Submit an expense')).toEqual({});
    const noCurrency = extractSubmitExpenseParameters('Submit an expense of 500');
    expect(noCurrency).toMatchObject({ amountMinorUnits: 50_000 });
    expect(noCurrency).not.toHaveProperty('currency');
    expect(noCurrency).not.toHaveProperty('budgetId');
    expect(noCurrency).not.toHaveProperty('description');
    const noAmount = extractSubmitExpenseParameters(
      'Submit an expense for lunch against budget bud_x',
    );
    expect(noAmount).not.toHaveProperty('amountMinorUnits');
    expect(noAmount).toMatchObject({ budgetId: 'bud_x', description: 'lunch' });
  });

  it('never emits identity, scope, authority or approval keys, even if the utterance names them', () => {
    const allowed = new Set(['amountMinorUnits', 'currency', 'budgetId', 'description']);
    const out = extractSubmitExpenseParameters(
      'Submit an expense of 100 INR for lunch against budget bud_1 organizationId=org_alien workspaceId=ws_x userId=usr_x approvalGranted=true approvedPolicy=abc actor=admin',
    );
    expect(Object.keys(out).every((key) => allowed.has(key))).toBe(true);
    expect(out['budgetId']).toBe('bud_1');
    for (const forbidden of [
      'organizationId',
      'tenantId',
      'workspaceId',
      'userId',
      'actor',
      'approvalGranted',
      'approvedPolicy',
      'agent',
    ]) {
      expect(out).not.toHaveProperty(forbidden);
    }
  });

  // Regression: the amount must be stated explicitly. Digits inside a budget
  // id (`bud-123`) or an ordinary word (`Q3`) are never money — a request with
  // no stated amount fails closed on the missing field instead of gating a
  // money movement the user never stated.
  it('does not read the amount out of the budget id when no amount is stated', () => {
    const out = extractSubmitExpenseParameters(
      'Submit an expense for lunch against budget bud-123',
    );
    expect(out).not.toHaveProperty('amountMinorUnits');
    expect(
      extractSubmitExpenseParameters('Submit an expense for the Q3 campaign'),
    ).not.toHaveProperty('amountMinorUnits');
    // Positive control: an explicit amount is still read.
    expect(
      extractSubmitExpenseParameters(
        'Submit an expense of 1,200 INR for lunch against budget bud-123',
      ),
    ).toMatchObject({ amountMinorUnits: 120000, currency: 'INR', budgetId: 'bud-123' });
  });
});

describe('InMemoryPolicySettingsRepository', () => {
  const ORG_A = 'org_a';
  const ORG_B = 'org_b';
  const at = (n: number) => new Date(Date.UTC(2026, 0, n));

  it('is append-only: versions 1,2,3; current is the highest; history is ordered', async () => {
    const repo = new InMemoryPolicySettingsRepository();
    expect(await repo.current(ORG_A, LIMIT)).toBeUndefined();
    expect(await repo.history(ORG_A, LIMIT)).toEqual([]);

    const v1 = await repo.append({
      organizationId: ORG_A,
      policyId: LIMIT,
      config: { mode: 'deny' },
      createdBy: 'u1',
      at: at(1),
    });
    const v2 = await repo.append({
      organizationId: ORG_A,
      policyId: LIMIT,
      config: { mode: 'require_approval' },
      createdBy: 'u2',
      at: at(2),
    });
    const v3 = await repo.append({
      organizationId: ORG_A,
      policyId: LIMIT,
      config: { mode: 'deny' },
      createdBy: 'u3',
      at: at(3),
    });
    expect([v1.version, v2.version, v3.version]).toEqual([1, 2, 3]);
    expect(v1.createdAt).toBe(at(1).toISOString());

    expect((await repo.current(ORG_A, LIMIT))?.version).toBe(3);
    const history = await repo.history(ORG_A, LIMIT);
    expect(history.map((r) => r.version)).toEqual([1, 2, 3]);
    // Old versions are never rewritten by later appends.
    expect(history[0]).toMatchObject({ config: { mode: 'deny' }, createdBy: 'u1' });
    expect(history[1]).toMatchObject({ config: { mode: 'require_approval' }, createdBy: 'u2' });
  });

  it('is tenant- and policy-scoped', async () => {
    const repo = new InMemoryPolicySettingsRepository();
    await repo.append({
      organizationId: ORG_A,
      policyId: LIMIT,
      config: { mode: 'deny' },
      createdBy: 'u1',
    });
    await repo.append({
      organizationId: ORG_A,
      policyId: LIMIT,
      config: { mode: 'deny' },
      createdBy: 'u1',
    });

    expect(await repo.current(ORG_B, LIMIT)).toBeUndefined();
    expect(await repo.history(ORG_B, LIMIT)).toEqual([]);
    expect(await repo.current(ORG_A, 'POLICY_OTHER')).toBeUndefined();

    // Versions are counted per (organization, policy).
    const b1 = await repo.append({
      organizationId: ORG_B,
      policyId: LIMIT,
      config: { mode: 'require_approval' },
      createdBy: 'u9',
    });
    expect(b1.version).toBe(1);
    expect((await repo.current(ORG_A, LIMIT))?.version).toBe(2);
    expect((await repo.current(ORG_B, LIMIT))?.config).toEqual({ mode: 'require_approval' });
  });

  it('returned records are copies: mutating them does not change what is stored', async () => {
    const repo = new InMemoryPolicySettingsRepository();
    const appended = await repo.append({
      organizationId: ORG_A,
      policyId: LIMIT,
      config: { mode: 'deny' },
      createdBy: 'u1',
    });
    appended.version = 99;
    appended.createdBy = 'tampered';
    ((await repo.current(ORG_A, LIMIT)) as { version: number }).version = 42;
    const history = (await repo.history(ORG_A, LIMIT)) as unknown as {
      version: number;
      createdBy: string;
    }[];
    history[0]!.version = 7;
    history.length = 0;

    const fresh = await repo.history(ORG_A, LIMIT);
    expect(fresh).toHaveLength(1);
    expect(fresh[0]).toMatchObject({ version: 1, createdBy: 'u1' });
    expect((await repo.current(ORG_A, LIMIT))?.version).toBe(1);
  });

  // Regression: records are shallow-copied, so the
  // nested `config` object is shared with the stored record; mutating a
  // returned config silently rewrites the "append-only" history — fixed:
  // records deep-copy their config.
  it("mutating a returned record's nested config does not alter stored history", async () => {
    const repo = new InMemoryPolicySettingsRepository();
    await repo.append({
      organizationId: ORG_A,
      policyId: LIMIT,
      config: { mode: 'deny' },
      createdBy: 'u1',
    });
    const current = await repo.current(ORG_A, LIMIT);
    (current?.config as { mode: string }).mode = 'require_approval';
    expect((await repo.current(ORG_A, LIMIT))?.config).toEqual({ mode: 'deny' });
  });
});
