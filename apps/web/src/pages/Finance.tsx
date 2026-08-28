/**
 * @nexora/app-web — Finance page.
 *
 * The CFO workspace's Finance vertical (S35): budgets with an allocated
 * amount and period, and expense claims decided against them — all through
 * the SAME REST surface the AI's `finance.submit_expense` and
 * `finance.flag_over_budget_items` tools use (`/api/finance/*`). Money is
 * always an integer count of minor units + a currency code (never a float);
 * this page formats for display, it never recomputes a total the backend
 * already computed (utilization comes from `/api/finance/budgets/
 * utilization`, the same projection the Command Center and the detection
 * signal read).
 *
 * RBAC: only a role holding `budgets.read`/`budgets.manage`/`expenses.read`/
 * `expenses.create`/`expenses.decide` can reach this data (currently
 * `finance.cfo` only) — the sidebar hides "Finance" for every other role
 * (`lib/modules.ts`), and this page's own fetch calls fail closed with a 403
 * the same way every other RBAC'd surface does.
 */

import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  Field,
  Input,
  Select,
  Stack,
  typography,
} from '@nexora/design-system';

import { AppShell } from '../components/AppShell.js';
import { ErrorState } from '../components/ErrorState.js';
import { LoadingScreen } from '../components/LoadingScreen.js';
import { api, ApiError } from '../lib/api.js';
import type {
  BudgetDto,
  BudgetUtilizationDto,
  DashboardResponse,
  ExpenseDto,
} from '../lib/types.js';
import { useSession } from '../session.js';

const NAME_MAX_LENGTH = 120;
const DESCRIPTION_MAX_LENGTH = 120;
/** The single demo currency this vertical slice's forms default to. */
const DEFAULT_CURRENCY = 'INR';

/** Formats a minor-units amount for display (e.g. `₹1,250.00`). */
function formatMoney(minorUnits: number, currency: string): string {
  const amount = minorUnits / 100;
  try {
    return new Intl.NumberFormat('en-IN', { style: 'currency', currency }).format(amount);
  } catch {
    return `${currency} ${amount.toFixed(2)}`;
  }
}

/** Formats an ISO date consistently (month present on both ends — avoids an ICU partial-options quirk). */
function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

/** The Finance application page. */
export function Finance(): JSX.Element {
  const { data: session } = useSession();
  const [searchParams] = useSearchParams();

  const [state, setState] = useState<{
    dashboard: DashboardResponse | null;
    budgets: BudgetDto[];
    utilization: BudgetUtilizationDto[];
    expenses: ExpenseDto[];
    loading: boolean;
    error: ApiError | null;
  }>({ dashboard: null, budgets: [], utilization: [], expenses: [], loading: true, error: null });

  const load = useCallback(async () => {
    setState((current) => ({ ...current, loading: true, error: null }));
    try {
      const params = new URLSearchParams();
      const organizationId = searchParams.get('organizationId');
      const workspaceId = searchParams.get('workspaceId');
      if (organizationId !== null) params.set('organizationId', organizationId);
      if (workspaceId !== null) params.set('workspaceId', workspaceId);
      const suffix = params.size > 0 ? `?${params.toString()}` : '';
      const dashboard = await api<DashboardResponse>(`/dashboard${suffix}`);
      if (dashboard.organization === null || dashboard.workspace === null) {
        setState({
          dashboard,
          budgets: [],
          utilization: [],
          expenses: [],
          loading: false,
          error: null,
        });
        return;
      }
      const scope = `organizationId=${encodeURIComponent(dashboard.organization.id)}&workspaceId=${encodeURIComponent(dashboard.workspace.id)}`;
      const [budgetsRes, utilizationRes, expensesRes] = await Promise.all([
        api<{ budgets: BudgetDto[] }>(`/finance/budgets?${scope}`),
        api<{ utilization: BudgetUtilizationDto[] }>(`/finance/budgets/utilization?${scope}`),
        api<{ expenses: ExpenseDto[] }>(`/finance/expenses?${scope}`),
      ]);
      setState({
        dashboard,
        budgets: budgetsRes.budgets,
        utilization: utilizationRes.utilization,
        expenses: expensesRes.expenses,
        loading: false,
        error: null,
      });
    } catch (error) {
      setState((current) => ({
        ...current,
        loading: false,
        error:
          error instanceof ApiError ? error : new ApiError(0, 'INTERNAL_ERROR', 'Request failed'),
      }));
    }
  }, [searchParams]);

  useEffect(() => {
    void load();
  }, [load]);

  if (state.loading && state.dashboard === null) {
    return <LoadingScreen />;
  }
  if (state.error !== null) {
    return <ErrorState message={state.error.message} onRetry={() => void load()} />;
  }
  const { dashboard } = state;
  if (dashboard === null || session === null) {
    return <LoadingScreen />;
  }
  if (dashboard.organization === null || dashboard.workspace === null) {
    return (
      <div
        style={{
          height: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: 24,
        }}
      >
        <Card padding={10} elevationLevel="md" style={{ maxWidth: 520, width: '100%' }}>
          <EmptyState
            icon="💰"
            title="Create a workspace first"
            description="Budgets and expenses live inside a workspace. Set one up to get started."
            action={
              <Button size="lg" onClick={() => void load()}>
                Reload
              </Button>
            }
          />
        </Card>
      </div>
    );
  }

  return (
    <AppShell
      user={dashboard.user}
      organizationName={dashboard.organization.name}
      workspaceName={dashboard.workspace.name}
      organizationId={dashboard.organization.id}
      workspaceId={dashboard.workspace.id}
    >
      <FinanceView
        organizationId={dashboard.organization.id}
        workspaceId={dashboard.workspace.id}
        organizationName={dashboard.organization.name}
        workspaceName={dashboard.workspace.name}
        currentUserId={dashboard.user.id}
        initialBudgets={state.budgets}
        initialUtilization={state.utilization}
        initialExpenses={state.expenses}
        onChanged={() => void load()}
      />
    </AppShell>
  );
}

/** Props of {@link FinanceView}. */
export interface FinanceViewProps {
  organizationId: string;
  workspaceId: string;
  organizationName: string;
  workspaceName: string;
  /** The signed-in user — an expense's own submitter cannot approve it. */
  currentUserId: string;
  initialBudgets: readonly BudgetDto[];
  initialUtilization: readonly BudgetUtilizationDto[];
  initialExpenses: readonly ExpenseDto[];
  onChanged: () => void;
}

/** The pure Finance content (exported for smoke tests). */
export function FinanceView({
  organizationId,
  workspaceId,
  organizationName,
  workspaceName,
  currentUserId,
  initialBudgets,
  initialUtilization,
  initialExpenses,
  onChanged,
}: FinanceViewProps): JSX.Element {
  const [budgets, setBudgets] = useState<BudgetDto[]>(() => [...initialBudgets]);
  const [utilization, setUtilization] = useState<BudgetUtilizationDto[]>(() => [
    ...initialUtilization,
  ]);
  const [expenses, setExpenses] = useState<ExpenseDto[]>(() => [...initialExpenses]);
  useEffect(() => setBudgets([...initialBudgets]), [initialBudgets]);
  useEffect(() => setUtilization([...initialUtilization]), [initialUtilization]);
  useEffect(() => setExpenses([...initialExpenses]), [initialExpenses]);

  const [creatingBudget, setCreatingBudget] = useState(false);
  const [submittingExpense, setSubmittingExpense] = useState(false);

  const budgetById = useMemo(
    () => new Map(budgets.map((budget) => [budget.id, budget])),
    [budgets],
  );
  const openBudgets = useMemo(
    () => budgets.filter((budget) => budget.status !== 'closed'),
    [budgets],
  );

  const summary = useMemo(() => {
    const open = utilization.filter((entry) => entry.status !== 'closed');
    const allocated = open.reduce((sum, entry) => sum + entry.allocatedMinorUnits, 0);
    const spent = open.reduce((sum, entry) => sum + entry.spentMinorUnits, 0);
    const overallPercent = allocated > 0 ? Math.round((spent / allocated) * 100) : 0;
    const pendingCount = expenses.filter((expense) => expense.status === 'pending').length;
    return { activeCount: open.length, overallPercent, pendingCount };
  }, [utilization, expenses]);

  const handleBudgetCreated = useCallback(
    (budget: BudgetDto) => {
      setBudgets((previous) => [budget, ...previous]);
      setCreatingBudget(false);
      onChanged();
    },
    [onChanged],
  );

  const handleBudgetUpdated = useCallback(
    (budget: BudgetDto) => {
      setBudgets((previous) => previous.map((item) => (item.id === budget.id ? budget : item)));
      onChanged();
    },
    [onChanged],
  );

  const handleExpenseCreated = useCallback(
    (expense: ExpenseDto) => {
      setExpenses((previous) => [expense, ...previous]);
      setSubmittingExpense(false);
      onChanged();
    },
    [onChanged],
  );

  const handleExpenseDecided = useCallback(
    (expense: ExpenseDto) => {
      setExpenses((previous) => previous.map((item) => (item.id === expense.id ? expense : item)));
      onChanged();
    },
    [onChanged],
  );

  return (
    <Stack gap={6} style={{ maxWidth: 1100, margin: '0 auto' }}>
      <Stack
        direction="row"
        gap={4}
        align="center"
        justify="space-between"
        style={{ flexWrap: 'wrap' }}
      >
        <Stack gap={1}>
          <h1 style={{ fontSize: typography.sizes['3xl'], fontWeight: typography.weights.bold, letterSpacing: '-0.03em', lineHeight: 1.1 }}>
            Finance
          </h1>
          <p style={{ fontSize: typography.sizes.sm, color: 'var(--nexora-textSecondary)' }}>
            {organizationName} · {workspaceName}
          </p>
        </Stack>
      </Stack>

      <div className="nexora-finance-summary">
        <Card style={{ padding: '16px 18px' }}>
          <Stack gap={1}>
            <span style={{ fontSize: typography.sizes.xs, color: 'var(--nexora-textMuted)' }}>
              Active budgets
            </span>
            <span style={{ fontSize: typography.sizes.xl, fontWeight: typography.weights.bold }}>
              {summary.activeCount}
            </span>
          </Stack>
        </Card>
        <Card style={{ padding: '16px 18px' }}>
          <Stack gap={1}>
            <span style={{ fontSize: typography.sizes.xs, color: 'var(--nexora-textMuted)' }}>
              Overall utilization
            </span>
            <span style={{ fontSize: typography.sizes.xl, fontWeight: typography.weights.bold }}>
              {summary.overallPercent}%
            </span>
          </Stack>
        </Card>
        <Card style={{ padding: '16px 18px' }}>
          <Stack gap={1}>
            <span style={{ fontSize: typography.sizes.xs, color: 'var(--nexora-textMuted)' }}>
              Pending approvals
            </span>
            <span style={{ fontSize: typography.sizes.xl, fontWeight: typography.weights.bold }}>
              {summary.pendingCount}
            </span>
          </Stack>
        </Card>
      </div>

      <Stack gap={3}>
        <Stack direction="row" gap={3} align="center" justify="space-between">
          <h2 style={{ fontSize: typography.sizes.lg, fontWeight: typography.weights.semibold }}>
            Budgets
          </h2>
          <Button size="sm" onClick={() => setCreatingBudget((open) => !open)}>
            {creatingBudget ? 'Cancel' : '+ New budget'}
          </Button>
        </Stack>

        {creatingBudget ? (
          <CreateBudgetForm
            organizationId={organizationId}
            workspaceId={workspaceId}
            onCreated={handleBudgetCreated}
            onCancel={() => setCreatingBudget(false)}
          />
        ) : null}

        {budgets.length === 0 && !creatingBudget ? (
          <Card>
            <EmptyState
              icon="💰"
              title="No budgets yet"
              description="Create a budget to start tracking allocated spend."
            />
          </Card>
        ) : (
          <Stack gap={2}>
            {utilization
              .slice()
              .sort((a, b) => b.utilizationPercent - a.utilizationPercent)
              .map((entry) => {
                const budget = budgetById.get(entry.budgetId);
                if (budget === undefined) return null;
                return (
                  <BudgetRow
                    key={budget.id}
                    budget={budget}
                    utilization={entry}
                    organizationId={organizationId}
                    workspaceId={workspaceId}
                    onUpdated={handleBudgetUpdated}
                  />
                );
              })}
          </Stack>
        )}
      </Stack>

      <Stack gap={3}>
        <Stack direction="row" gap={3} align="center" justify="space-between">
          <h2 style={{ fontSize: typography.sizes.lg, fontWeight: typography.weights.semibold }}>
            Expenses
          </h2>
          <Button
            size="sm"
            onClick={() => setSubmittingExpense((open) => !open)}
            disabled={openBudgets.length === 0}
          >
            {submittingExpense ? 'Cancel' : '+ New expense'}
          </Button>
        </Stack>

        {submittingExpense ? (
          <SubmitExpenseForm
            organizationId={organizationId}
            workspaceId={workspaceId}
            budgets={openBudgets}
            onCreated={handleExpenseCreated}
            onCancel={() => setSubmittingExpense(false)}
          />
        ) : null}

        {expenses.length === 0 && !submittingExpense ? (
          <Card>
            <EmptyState
              icon="🧾"
              title="No expenses yet"
              description="Submit an expense claim against an open budget."
            />
          </Card>
        ) : (
          <Stack gap={2}>
            {expenses.map((expense) => (
              <ExpenseRow
                key={expense.id}
                expense={expense}
                budgetName={budgetById.get(expense.budgetId)?.name ?? 'Unknown budget'}
                organizationId={organizationId}
                workspaceId={workspaceId}
                isOwnSubmission={expense.submittedBy === currentUserId}
                onDecided={handleExpenseDecided}
              />
            ))}
          </Stack>
        )}
      </Stack>

      <style>{`
        .nexora-finance-summary {
          display: grid;
          grid-template-columns: repeat(3, minmax(0, 1fr));
          gap: 12px;
        }
        @media (max-width: 768px) {
          .nexora-finance-summary { grid-template-columns: 1fr; }
        }
      `}</style>
    </Stack>
  );
}

/** A budget's status as a badge. */
export function BudgetStatusBadge({ status }: { status: string }): JSX.Element {
  if (status === 'closed') {
    return <Badge tone="neutral">Closed</Badge>;
  }
  if (status === 'under_review') {
    return (
      <Badge tone="warning" dot>
        Under review
      </Badge>
    );
  }
  return (
    <Badge tone="success" dot>
      Active
    </Badge>
  );
}

/** An expense's status as a badge. */
export function ExpenseStatusBadge({ status }: { status: string }): JSX.Element {
  if (status === 'approved') {
    return <Badge tone="success">Approved</Badge>;
  }
  if (status === 'rejected') {
    return <Badge tone="danger">Rejected</Badge>;
  }
  return (
    <Badge tone="warning" dot>
      Pending
    </Badge>
  );
}

/** A utilization progress bar (color reflects risk). */
function UtilizationBar({ percent, status }: { percent: number; status: string }): JSX.Element {
  const color =
    status === 'under_review' || percent >= 90
      ? 'var(--nexora-danger)'
      : percent >= 75
        ? 'var(--nexora-warning)'
        : 'var(--nexora-primary)';
  return (
    <div
      style={{
        height: 6,
        borderRadius: 3,
        background: 'var(--nexora-borderSubtle)',
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          height: '100%',
          width: `${Math.min(percent, 100)}%`,
          background: color,
          borderRadius: 3,
        }}
      />
    </div>
  );
}

/** Validates budget input against the SAME rules the backend enforces. */
function validateBudgetInput(
  name: string,
  allocatedInput: string,
  periodStart: string,
  periodEnd: string,
): { field: string; message: string }[] {
  const issues: { field: string; message: string }[] = [];
  const trimmedName = name.trim();
  if (trimmedName.length === 0) {
    issues.push({ field: 'name', message: 'A name is required' });
  } else if (trimmedName.length > NAME_MAX_LENGTH) {
    issues.push({ field: 'name', message: `Must be at most ${NAME_MAX_LENGTH} characters` });
  }
  const allocated = Number(allocatedInput);
  if (!Number.isFinite(allocated) || allocated <= 0 || !Number.isInteger(allocated * 100)) {
    issues.push({ field: 'allocated', message: 'Enter a valid positive amount' });
  }
  if (periodStart.trim().length === 0) {
    issues.push({ field: 'periodStart', message: 'A start date is required' });
  }
  if (periodEnd.trim().length === 0) {
    issues.push({ field: 'periodEnd', message: 'An end date is required' });
  }
  if (
    periodStart.trim().length > 0 &&
    periodEnd.trim().length > 0 &&
    new Date(periodEnd).getTime() <= new Date(periodStart).getTime()
  ) {
    issues.push({ field: 'periodEnd', message: 'End date must be after the start date' });
  }
  return issues;
}

/** The inline create-budget form. */
function CreateBudgetForm({
  organizationId,
  workspaceId,
  onCreated,
  onCancel,
}: {
  organizationId: string;
  workspaceId: string;
  onCreated: (budget: BudgetDto) => void;
  onCancel: () => void;
}): JSX.Element {
  const [name, setName] = useState('');
  const [allocated, setAllocated] = useState('');
  const [periodStart, setPeriodStart] = useState('');
  const [periodEnd, setPeriodEnd] = useState('');
  const [issues, setIssues] = useState<{ field: string; message: string }[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const issueFor = (field: string): string | undefined =>
    issues.find((issue) => issue.field === field)?.message;

  const handleSubmit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    const validation = validateBudgetInput(name, allocated, periodStart, periodEnd);
    setIssues(validation);
    if (validation.length > 0) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      const created = await api<{ budget: BudgetDto }>('/finance/budgets', {
        method: 'POST',
        body: JSON.stringify({
          organizationId,
          workspaceId,
          name: name.trim(),
          allocatedMinorUnits: Math.round(Number(allocated) * 100),
          currency: DEFAULT_CURRENCY,
          periodStart: new Date(periodStart).toISOString(),
          periodEnd: new Date(periodEnd).toISOString(),
        }),
      });
      onCreated(created.budget);
    } catch (error) {
      setSubmitError(error instanceof ApiError ? error.message : 'Could not create the budget.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Card>
      <form onSubmit={(event) => void handleSubmit(event)}>
        <Stack gap={4} stretch>
          <div style={{ fontWeight: typography.weights.semibold }}>New budget</div>
          <Field label="Name" required error={issueFor('name')}>
            <Input
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Engineering Q3 Budget"
              invalid={issueFor('name') !== undefined}
              maxLength={NAME_MAX_LENGTH}
            />
          </Field>
          <Field
            label={`Allocated amount (${DEFAULT_CURRENCY})`}
            required
            error={issueFor('allocated')}
          >
            <Input
              type="number"
              min="0"
              step="0.01"
              value={allocated}
              onChange={(event) => setAllocated(event.target.value)}
              placeholder="500000"
              invalid={issueFor('allocated') !== undefined}
            />
          </Field>
          <Stack direction="row" gap={3} stretch style={{ flexWrap: 'wrap' }}>
            <div style={{ flex: '1 1 160px' }}>
              <Field label="Period start" required error={issueFor('periodStart')}>
                <Input
                  type="date"
                  value={periodStart}
                  onChange={(event) => setPeriodStart(event.target.value)}
                  invalid={issueFor('periodStart') !== undefined}
                />
              </Field>
            </div>
            <div style={{ flex: '1 1 160px' }}>
              <Field label="Period end" required error={issueFor('periodEnd')}>
                <Input
                  type="date"
                  value={periodEnd}
                  onChange={(event) => setPeriodEnd(event.target.value)}
                  invalid={issueFor('periodEnd') !== undefined}
                />
              </Field>
            </div>
          </Stack>
          {submitError !== null ? (
            <p style={{ fontSize: typography.sizes.sm, color: 'var(--nexora-danger)' }}>
              {submitError}
            </p>
          ) : null}
          <Stack direction="row" gap={3}>
            <Button type="submit" size="sm" loading={submitting} disabled={submitting}>
              {submitting ? 'Creating…' : 'Create budget'}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={onCancel}
              disabled={submitting}
            >
              Discard
            </Button>
          </Stack>
        </Stack>
      </form>
    </Card>
  );
}

/** A single budget row: name, period, utilization bar, status, and actions. */
export function BudgetRow({
  budget,
  utilization,
  organizationId,
  workspaceId,
  onUpdated,
}: {
  budget: BudgetDto;
  utilization: BudgetUtilizationDto;
  organizationId: string;
  workspaceId: string;
  onUpdated: (budget: BudgetDto) => void;
}): JSX.Element {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isClosed = budget.status === 'closed';

  const runAction = async (path: string): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      const result = await api<{ budget: BudgetDto }>(path, {
        method: 'POST',
        body: JSON.stringify({ organizationId, workspaceId }),
      });
      onUpdated(result.budget);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Could not update the budget.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card style={{ padding: '14px 16px', opacity: isClosed ? 0.7 : 1 }}>
      <Stack gap={2}>
        <Stack
          direction="row"
          gap={3}
          align="center"
          justify="space-between"
          style={{ flexWrap: 'wrap' }}
        >
          <Stack gap={0.5} style={{ minWidth: 0, flex: '1 1 240px' }}>
            <div style={{ fontWeight: typography.weights.semibold }}>{budget.name}</div>
            <span style={{ fontSize: typography.sizes.xs, color: 'var(--nexora-textMuted)' }}>
              {formatDate(budget.periodStart)} – {formatDate(budget.periodEnd)}
            </span>
          </Stack>
          <BudgetStatusBadge status={budget.status} />
        </Stack>
        <UtilizationBar percent={utilization.utilizationPercent} status={budget.status} />
        <Stack direction="row" gap={3} align="center" justify="space-between">
          <span style={{ fontSize: typography.sizes.xs, color: 'var(--nexora-textMuted)' }}>
            {formatMoney(utilization.spentMinorUnits, utilization.currency)} of{' '}
            {formatMoney(utilization.allocatedMinorUnits, utilization.currency)} (
            {utilization.utilizationPercent}%)
          </span>
          {!isClosed ? (
            <Stack direction="row" gap={2}>
              {budget.status === 'under_review' ? (
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={busy}
                  onClick={() => void runAction(`/finance/budgets/${budget.id}/clear-review`)}
                >
                  Clear review
                </Button>
              ) : null}
              <Button
                size="sm"
                variant="ghost"
                disabled={busy}
                onClick={() => void runAction(`/finance/budgets/${budget.id}/close`)}
              >
                Close
              </Button>
            </Stack>
          ) : null}
        </Stack>
        {error !== null ? (
          <div style={{ fontSize: typography.sizes.xs, color: 'var(--nexora-danger)' }}>
            {error}
          </div>
        ) : null}
      </Stack>
    </Card>
  );
}

/** Validates expense input against the SAME rules the backend enforces. */
function validateExpenseInput(
  budgetId: string,
  description: string,
  amountInput: string,
): { field: string; message: string }[] {
  const issues: { field: string; message: string }[] = [];
  if (budgetId.trim().length === 0) {
    issues.push({ field: 'budgetId', message: 'A budget is required' });
  }
  const trimmedDescription = description.trim();
  if (trimmedDescription.length === 0) {
    issues.push({ field: 'description', message: 'A description is required' });
  } else if (trimmedDescription.length > DESCRIPTION_MAX_LENGTH) {
    issues.push({
      field: 'description',
      message: `Must be at most ${DESCRIPTION_MAX_LENGTH} characters`,
    });
  }
  const amount = Number(amountInput);
  if (!Number.isFinite(amount) || amount <= 0 || !Number.isInteger(amount * 100)) {
    issues.push({ field: 'amount', message: 'Enter a valid positive amount' });
  }
  return issues;
}

/** The inline submit-expense form. */
function SubmitExpenseForm({
  organizationId,
  workspaceId,
  budgets,
  onCreated,
  onCancel,
}: {
  organizationId: string;
  workspaceId: string;
  budgets: readonly BudgetDto[];
  onCreated: (expense: ExpenseDto) => void;
  onCancel: () => void;
}): JSX.Element {
  const [budgetId, setBudgetId] = useState(budgets[0]?.id ?? '');
  const [description, setDescription] = useState('');
  const [amount, setAmount] = useState('');
  const [issues, setIssues] = useState<{ field: string; message: string }[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const issueFor = (field: string): string | undefined =>
    issues.find((issue) => issue.field === field)?.message;

  const handleSubmit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    const validation = validateExpenseInput(budgetId, description, amount);
    setIssues(validation);
    if (validation.length > 0) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      const created = await api<{ expense: ExpenseDto }>('/finance/expenses', {
        method: 'POST',
        body: JSON.stringify({
          organizationId,
          workspaceId,
          budgetId,
          description: description.trim(),
          amountMinorUnits: Math.round(Number(amount) * 100),
          currency: DEFAULT_CURRENCY,
        }),
      });
      onCreated(created.expense);
    } catch (error) {
      setSubmitError(error instanceof ApiError ? error.message : 'Could not submit the expense.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Card>
      <form onSubmit={(event) => void handleSubmit(event)}>
        <Stack gap={4} stretch>
          <Stack gap={1}>
            <div style={{ fontWeight: typography.weights.semibold }}>New expense</div>
            <div style={{ fontSize: typography.sizes.xs, color: 'var(--nexora-textMuted)' }}>
              The AI can also submit claims — “Submit a ₹2,500 travel expense against Marketing Q3.”
            </div>
          </Stack>
          <Field label="Budget" required error={issueFor('budgetId')}>
            <Select
              value={budgetId}
              onChange={(event) => setBudgetId(event.target.value)}
              invalid={issueFor('budgetId') !== undefined}
            >
              {budgets.map((budget) => (
                <option key={budget.id} value={budget.id}>
                  {budget.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Description" required error={issueFor('description')}>
            <Input
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="Conference travel"
              invalid={issueFor('description') !== undefined}
              maxLength={DESCRIPTION_MAX_LENGTH}
            />
          </Field>
          <Field label={`Amount (${DEFAULT_CURRENCY})`} required error={issueFor('amount')}>
            <Input
              type="number"
              min="0"
              step="0.01"
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
              placeholder="2500"
              invalid={issueFor('amount') !== undefined}
            />
          </Field>
          {submitError !== null ? (
            <p style={{ fontSize: typography.sizes.sm, color: 'var(--nexora-danger)' }}>
              {submitError}
            </p>
          ) : null}
          <Stack direction="row" gap={3}>
            <Button type="submit" size="sm" loading={submitting} disabled={submitting}>
              {submitting ? 'Submitting…' : 'Submit expense'}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={onCancel}
              disabled={submitting}
            >
              Discard
            </Button>
          </Stack>
        </Stack>
      </form>
    </Card>
  );
}

/** A single expense row: description, amount, budget, status, and (when pending) decide actions. */
export function ExpenseRow({
  expense,
  budgetName,
  organizationId,
  workspaceId,
  isOwnSubmission = false,
  onDecided,
}: {
  expense: ExpenseDto;
  budgetName: string;
  organizationId: string;
  workspaceId: string;
  /** True when the signed-in user submitted this expense (cannot approve it). */
  isOwnSubmission?: boolean;
  onDecided: (expense: ExpenseDto) => void;
}): JSX.Element {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isPending = expense.status === 'pending';

  const decide = async (decision: 'approve' | 'reject'): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      const result = await api<{ expense: ExpenseDto }>(`/finance/expenses/${expense.id}/decide`, {
        method: 'POST',
        body: JSON.stringify({ organizationId, workspaceId, decision }),
      });
      onDecided(result.expense);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Could not decide the expense.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card style={{ padding: '14px 16px', opacity: isPending ? 1 : 0.85 }}>
      <Stack
        direction="row"
        gap={3}
        align="center"
        justify="space-between"
        style={{ flexWrap: 'wrap' }}
      >
        <Stack gap={0.5} style={{ minWidth: 0, flex: '1 1 240px' }}>
          <div style={{ fontWeight: typography.weights.semibold }}>{expense.description}</div>
          <Stack direction="row" gap={2} align="center" style={{ flexWrap: 'wrap' }}>
            <ExpenseStatusBadge status={expense.status} />
            <span style={{ fontSize: typography.sizes.xs, color: 'var(--nexora-textMuted)' }}>
              {formatMoney(expense.amountMinorUnits, expense.currency)} · {budgetName}
            </span>
          </Stack>
          {error !== null ? (
            <div style={{ fontSize: typography.sizes.xs, color: 'var(--nexora-danger)' }}>
              {error}
            </div>
          ) : null}
        </Stack>
        {isPending ? (
          <Stack direction="row" gap={2} align="center" style={{ flexShrink: 0 }}>
            <Button
              size="sm"
              variant="primary"
              disabled={busy || isOwnSubmission}
              loading={busy}
              title={
                isOwnSubmission
                  ? 'You submitted this expense — a different approver must decide it'
                  : undefined
              }
              onClick={() => void decide('approve')}
            >
              Approve
            </Button>
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => void decide('reject')}>
              Reject
            </Button>
          </Stack>
        ) : null}
      </Stack>
    </Card>
  );
}
