/**
 * @nexora/app-api — SubmitExpenseTool.
 *
 * The Finance write capability exposed to the Enterprise AI Runtime: it
 * submits an expense claim against a budget in the current workspace
 * through the Finance **application layer** — the SAME `SubmitExpenseHandler`
 * the REST surface uses — so humans and AI converge on one business
 * execution path.
 *
 * Security contract (same model as {@link CreateCalendarEventTool}):
 * - Input accepts ONLY the user-controlled business values (`budgetId`,
 *   `description`, `amountMinorUnits`, `currency`) — `additionalProperties:
 *   false`. The model can never supply `userId`, `tenantId`,
 *   `organizationId`, `workspaceId`, permissions, or approval state —
 *   identity, tenant, and workspace come exclusively from the trusted
 *   execution context assembled from the authenticated session.
 * - Workspace scope is mandatory: expenses are workspace-scoped. Without a
 *   trusted workspace context the tool fails closed.
 * - Authorization mirrors the REST surface (`POST /api/finance/expenses`):
 *   membership of the trusted tenant AND the trusted workspace, PLUS the
 *   caller's effective `expenses.create` RBAC capability (re-checked
 *   independently by the application layer's `budgets.manage`-gated scope
 *   check on the referenced budget — a budget outside the trusted scope
 *   resolves to NOT FOUND, never a cross-workspace write).
 * - Money movement: this is a Consequential capability (BR-19) — approval
 *   is always required before the write executes (see the tool manifest).
 * - Delegation: the tool calls the SubmitExpenseHandler (application
 *   layer) — never Drizzle, never repositories, never domain objects.
 * - Verification: the created expense must belong to the trusted tenant +
 *   workspace; the model never decides success — the application result is
 *   authoritative. A read-back through ListExpensesHandler confirms the
 *   expense is actually persisted in the trusted workspace.
 */

import type { TenantId, UserId, WorkspaceId } from '@nexora/contracts/common';
import type { Tool, ToolExecutionContext, ToolManifest, ToolResult } from '@nexora/agent-sdk/tools';
import type { ListExpensesHandler, SubmitExpenseHandler } from '@nexora/application-finance';
import type { ListOrganizationsHandler } from '@nexora/application-organizations';
import type { ListMyWorkspacesHandler } from '@nexora/application-workspaces';

/** Input contract: ONLY user-controlled business values (identity is never input). */
export interface SubmitExpenseInput {
  /** The budget this expense is claimed against (user-controlled business value). */
  budgetId: string;
  /** The expense description. */
  description: string;
  /** The claimed amount, in minor units. */
  amountMinorUnits: number;
  /** The three-letter currency code. */
  currency: string;
}

/** Output contract of {@link SubmitExpenseTool}. */
export interface SubmitExpenseOutput {
  /** The submitted (pending) expense (authoritative application-layer result). */
  expense: {
    id: string;
    budgetId: string;
    description: string;
    amountMinorUnits: number;
    currency: string;
    /** The lifecycle status (`pending`). */
    status: string;
    /** The owning workspace id — must equal the trusted workspace. */
    workspaceId: string;
    createdAt: string;
  };
}

/** The tool manifest: consequential (money movement, always gated — BR-19). */
export const SUBMIT_EXPENSE_MANIFEST: ToolManifest = {
  id: 'finance.submit_expense',
  name: 'Submit expense',
  description: 'Submits an expense claim against a budget in the current workspace',
  sideEffectClass: 'consequential',
  idempotent: false,
  timeoutMs: 15_000,
  inputSchema: {
    type: 'object',
    properties: {
      budgetId: { type: 'string', minLength: 1 },
      description: { type: 'string', minLength: 1, maxLength: 120 },
      amountMinorUnits: { type: 'integer', minimum: 1 },
      currency: { type: 'string', minLength: 3, maxLength: 3 },
    },
    required: ['budgetId', 'description', 'amountMinorUnits', 'currency'],
    additionalProperties: false,
  },
};

/** The maximum description length (mirrors the application validator). */
const DESCRIPTION_MAX_LENGTH = 120;

/**
 * The write tool that submits an expense claim through the Finance
 * application layer under the trusted execution context.
 */
export class SubmitExpenseTool implements Tool<SubmitExpenseInput, SubmitExpenseOutput> {
  readonly manifest = SUBMIT_EXPENSE_MANIFEST;

  readonly #submitExpense: SubmitExpenseHandler;
  readonly #listOrganizations: ListOrganizationsHandler;
  readonly #listMyWorkspaces: ListMyWorkspacesHandler;
  readonly #listExpenses: ListExpensesHandler;

  constructor(dependencies: {
    submitExpense: SubmitExpenseHandler;
    listOrganizations: ListOrganizationsHandler;
    listMyWorkspaces: ListMyWorkspacesHandler;
    /** The workspace-scoped read-back handler (verification). */
    listExpenses: ListExpensesHandler;
  }) {
    this.#submitExpense = dependencies.submitExpense;
    this.#listOrganizations = dependencies.listOrganizations;
    this.#listMyWorkspaces = dependencies.listMyWorkspaces;
    this.#listExpenses = dependencies.listExpenses;
  }

  async execute(
    input: SubmitExpenseInput,
    context: ToolExecutionContext,
  ): Promise<ToolResult<SubmitExpenseOutput>> {
    // 1. Validate the user-controlled input (untrusted model/user values).
    const budgetId = typeof input?.budgetId === 'string' ? input.budgetId.trim() : '';
    if (budgetId.length === 0) {
      return this.#failure('A budget id is required');
    }
    const description = typeof input?.description === 'string' ? input.description.trim() : '';
    if (description.length === 0) {
      return this.#failure('An expense description is required');
    }
    if (description.length > DESCRIPTION_MAX_LENGTH) {
      return this.#failure(
        `Expense description must be at most ${DESCRIPTION_MAX_LENGTH} characters`,
      );
    }
    const amountMinorUnits = input?.amountMinorUnits;
    if (
      typeof amountMinorUnits !== 'number' ||
      !Number.isInteger(amountMinorUnits) ||
      amountMinorUnits <= 0
    ) {
      return this.#failure('A positive whole-number amount (in minor units) is required');
    }
    const currency = typeof input?.currency === 'string' ? input.currency.toUpperCase() : '';
    if (!/^[A-Z]{3}$/.test(currency)) {
      return this.#failure('A three-letter currency code is required');
    }

    // 2. Workspace scope is mandatory: expenses are workspace-scoped.
    const workspaceId = context.workspaceId;
    if (workspaceId === undefined || workspaceId.length === 0) {
      return this.#failure('A workspace is required to submit an expense');
    }

    // 3. Authorization: the caller must be a member of the trusted tenant
    //    AND the trusted workspace. Identity, tenant, and workspace come
    //    from the trusted execution context — never from the prompt.
    const membership = await this.#listOrganizations.handle({ userId: context.userId as UserId });
    if (!membership.ok || !membership.value.some((org) => org.id === context.tenantId)) {
      return this.#failure('You are not authorized to submit an expense in this organization');
    }
    const workspaces = await this.#listMyWorkspaces.handle({
      userId: context.userId as UserId,
      organizationId: context.tenantId as TenantId,
    });
    if (!workspaces.ok || !workspaces.value.some((workspace) => workspace.id === workspaceId)) {
      return this.#failure('You are not authorized to submit an expense in this workspace');
    }

    // 4. Delegate to the application layer (the authoritative path — it
    //    independently verifies the referenced budget is visible in the
    //    trusted scope and not closed).
    const result = await this.#submitExpense.handle({
      organizationId: context.tenantId as TenantId,
      workspaceId: workspaceId as WorkspaceId,
      budgetId,
      submittedBy: context.userId as UserId,
      actorId: context.userId as UserId,
      correlationId: context.executionId,
      description,
      amountMinorUnits,
      currency,
    });
    if (!result.ok) {
      return this.#failure(submitExpenseErrorMessage(result.error));
    }

    // 5. Verify the authoritative result against the trusted scope.
    const expense = result.value.expense;
    if (expense.organizationId !== context.tenantId || expense.workspaceId !== workspaceId) {
      return this.#failure('Expense verification failed: unexpected scope');
    }

    // 6. Read-back verification: read the persisted state back and confirm
    //    the submitted expense is actually present in the trusted workspace.
    const readBack = await this.#listExpenses.handle({
      organizationId: context.tenantId as TenantId,
      workspaceId: workspaceId as WorkspaceId,
    });
    const persisted =
      readBack.ok &&
      readBack.value.some(
        (item) =>
          item.id === expense.id &&
          item.workspaceId === workspaceId &&
          item.organizationId === context.tenantId,
      );
    if (!persisted) {
      return this.#failure(
        'Expense verification failed: submitted expense not found in the workspace',
      );
    }

    return {
      ok: true,
      output: {
        expense: {
          id: expense.id,
          budgetId: expense.budgetId,
          description: expense.description.value,
          amountMinorUnits: expense.amount.minorUnits,
          currency: expense.amount.currency,
          status: expense.status.value,
          workspaceId: expense.workspaceId,
          createdAt: expense.createdAt,
        },
      },
      completedAt: new Date().toISOString(),
    };
  }

  #failure(error: string): ToolResult<SubmitExpenseOutput> {
    return { ok: false, error, completedAt: new Date().toISOString() };
  }
}

/**
 * Maps an application-layer error to a safe user-facing message (never
 * internal details or stack traces).
 */
function submitExpenseErrorMessage(error: { code?: string; message?: string }): string {
  switch (error.code) {
    case 'VALIDATION_ERROR':
      return 'The expense details are invalid';
    case 'NOT_FOUND':
      return 'The referenced budget could not be found';
    default:
      return 'Could not submit the expense';
  }
}
