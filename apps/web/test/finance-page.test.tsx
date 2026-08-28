/**
 * Server-render smoke tests for the Finance application: the pure
 * `FinanceView` renders the summary KPIs, budgets, expenses, empty states,
 * and status badges without crashing (no DOM or network required — same
 * convention as the other `*-page.test.tsx` files).
 */

import { describe, expect, it } from 'vitest';
import { renderToString } from 'react-dom/server';

import {
  BudgetRow,
  BudgetStatusBadge,
  ExpenseRow,
  ExpenseStatusBadge,
  FinanceView,
} from '../src/pages/Finance.js';
import type { BudgetDto, BudgetUtilizationDto, ExpenseDto } from '../src/lib/types.js';

const ORGANIZATION = 'org_acme';
const WORKSPACE = 'wsp_finance';

function budget(overrides: Partial<BudgetDto> = {}): BudgetDto {
  return {
    id: 'bud_1',
    organizationId: ORGANIZATION,
    workspaceId: WORKSPACE,
    createdBy: 'usr_1',
    name: 'Marketing Q3',
    allocatedMinorUnits: 100_000,
    currency: 'INR',
    periodStart: '2026-07-01T00:00:00.000Z',
    periodEnd: '2026-09-30T00:00:00.000Z',
    status: 'active',
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

function utilization(overrides: Partial<BudgetUtilizationDto> = {}): BudgetUtilizationDto {
  return {
    budgetId: 'bud_1',
    name: 'Marketing Q3',
    currency: 'INR',
    allocatedMinorUnits: 100_000,
    spentMinorUnits: 25_000,
    utilizationPercent: 25,
    status: 'active',
    ...overrides,
  };
}

function expense(overrides: Partial<ExpenseDto> = {}): ExpenseDto {
  return {
    id: 'exp_1',
    organizationId: ORGANIZATION,
    workspaceId: WORKSPACE,
    budgetId: 'bud_1',
    submittedBy: 'usr_1',
    description: 'Conference travel',
    amountMinorUnits: 25_000,
    currency: 'INR',
    status: 'pending',
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

describe('FinanceView', () => {
  it('renders the page header, org/workspace context, and summary KPIs', () => {
    const html = renderToString(
      <FinanceView
        organizationId={ORGANIZATION}
        workspaceId={WORKSPACE}
        organizationName="Acme Inc."
        workspaceName="Finance"
        currentUserId="usr_viewer"
        initialBudgets={[budget()]}
        initialUtilization={[utilization()]}
        initialExpenses={[expense()]}
        onChanged={() => undefined}
      />,
    );
    expect(html).toContain('Finance');
    expect(html).toContain('Acme Inc.');
    expect(html).toContain('Active budgets');
    expect(html).toContain('Overall utilization');
    expect(html).toContain('Pending approvals');
    expect(html).toContain('Marketing Q3');
    expect(html).toContain('Conference travel');
  });

  it('renders honest empty states when there are no budgets or expenses', () => {
    const html = renderToString(
      <FinanceView
        organizationId={ORGANIZATION}
        workspaceId={WORKSPACE}
        organizationName="Acme Inc."
        workspaceName="Finance"
        currentUserId="usr_viewer"
        initialBudgets={[]}
        initialUtilization={[]}
        initialExpenses={[]}
        onChanged={() => undefined}
      />,
    );
    expect(html).toContain('No budgets yet');
    expect(html).toContain('No expenses yet');
  });
});

describe('BudgetRow', () => {
  it('renders name, period, utilization, and Close for an active budget', () => {
    const html = renderToString(
      <BudgetRow
        budget={budget()}
        utilization={utilization()}
        organizationId={ORGANIZATION}
        workspaceId={WORKSPACE}
        onUpdated={() => undefined}
      />,
    );
    expect(html).toContain('Marketing Q3');
    expect(html).toContain('Active');
    expect(html).toContain('25%');
    expect(html).toContain('Close');
    expect(html).not.toContain('Clear review');
  });

  it('renders "Clear review" only for a budget under review', () => {
    const html = renderToString(
      <BudgetRow
        budget={budget({ status: 'under_review' })}
        utilization={utilization({ status: 'under_review', utilizationPercent: 95 })}
        organizationId={ORGANIZATION}
        workspaceId={WORKSPACE}
        onUpdated={() => undefined}
      />,
    );
    expect(html).toContain('Under review');
    expect(html).toContain('Clear review');
  });

  it('renders a closed budget as read-only (no Close/Clear-review controls)', () => {
    const html = renderToString(
      <BudgetRow
        budget={budget({ status: 'closed' })}
        utilization={utilization({ status: 'closed' })}
        organizationId={ORGANIZATION}
        workspaceId={WORKSPACE}
        onUpdated={() => undefined}
      />,
    );
    expect(html).toContain('Closed');
    expect(html).not.toContain('>Close<');
    expect(html).not.toContain('Clear review');
  });
});

describe('ExpenseRow', () => {
  it('renders description, amount, budget name, and decide actions for a pending expense', () => {
    const html = renderToString(
      <ExpenseRow
        expense={expense()}
        budgetName="Marketing Q3"
        organizationId={ORGANIZATION}
        workspaceId={WORKSPACE}
        onDecided={() => undefined}
      />,
    );
    expect(html).toContain('Conference travel');
    expect(html).toContain('Marketing Q3');
    expect(html).toContain('Pending');
    expect(html).toContain('Approve');
    expect(html).toContain('Reject');
  });

  it('renders a decided expense as read-only (no Approve/Reject controls)', () => {
    const html = renderToString(
      <ExpenseRow
        expense={expense({ status: 'approved', decidedBy: 'usr_cfo' })}
        budgetName="Marketing Q3"
        organizationId={ORGANIZATION}
        workspaceId={WORKSPACE}
        onDecided={() => undefined}
      />,
    );
    expect(html).toContain('Approved');
    expect(html).not.toContain('>Approve<');
    expect(html).not.toContain('>Reject<');
  });

  it('disables Approve for the expense the signed-in user submitted (segregation of duties)', () => {
    const html = renderToString(
      <ExpenseRow
        expense={expense({ submittedBy: 'usr_1' })}
        budgetName="Marketing Q3"
        organizationId={ORGANIZATION}
        workspaceId={WORKSPACE}
        isOwnSubmission
        onDecided={() => undefined}
      />,
    );
    // Approve is still rendered but disabled with an explanatory title; Reject
    // (a withdrawal) stays available.
    expect(html).toContain('Approve');
    expect(html).toContain('a different approver must decide it');
    expect(html).toContain('disabled');
    expect(html).toContain('>Reject<');
  });
});

describe('BudgetStatusBadge', () => {
  it('renders all three lifecycle statuses', () => {
    expect(renderToString(<BudgetStatusBadge status="active" />)).toContain('Active');
    expect(renderToString(<BudgetStatusBadge status="under_review" />)).toContain('Under review');
    expect(renderToString(<BudgetStatusBadge status="closed" />)).toContain('Closed');
  });
});

describe('ExpenseStatusBadge', () => {
  it('renders all three lifecycle statuses', () => {
    expect(renderToString(<ExpenseStatusBadge status="pending" />)).toContain('Pending');
    expect(renderToString(<ExpenseStatusBadge status="approved" />)).toContain('Approved');
    expect(renderToString(<ExpenseStatusBadge status="rejected" />)).toContain('Rejected');
  });
});
