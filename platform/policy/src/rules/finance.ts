import { POLICY_IDS } from '../ids.js';
import type { BudgetFact, PolicyRequest, PolicyRule, RuleVerdict } from '../contracts.js';

/** The capability these finance rules govern. */
export const SUBMIT_EXPENSE_CAPABILITY = 'finance.submit_expense';

function isExpense(request: PolicyRequest): boolean {
  return request.capabilityId === SUBMIT_EXPENSE_CAPABILITY;
}

/** The claimed amount, when it is a positive safe integer (operand, never a claim). */
function amountOf(request: PolicyRequest): number | undefined {
  const amount = request.input['amountMinorUnits'];
  return typeof amount === 'number' && Number.isSafeInteger(amount) && amount > 0
    ? amount
    : undefined;
}

/**
 * POLICY_FINANCE_EXPENSE_APPROVAL — money movement is Consequential (BR-19):
 * submitting an expense always requires human approval, whatever the amount.
 * (There is deliberately NO amount threshold here: the platform has none.
 * The ₹50,000 figure in the sample expense-policy article is prose, not a
 * rule — see the org-configurable POLICY_FINANCE_BUDGET_LIMIT for the only
 * amount-aware policy.)
 */
export const financeExpenseApprovalRule: PolicyRule = {
  id: POLICY_IDS.FINANCE_EXPENSE_APPROVAL,
  version: '1',
  evaluate(request): RuleVerdict | undefined {
    if (!isExpense(request)) {
      return undefined;
    }
    return {
      outcome: 'REQUIRE_APPROVAL',
      reasonCode: 'MONEY_MOVEMENT',
      reason: 'Submitting an expense moves money and always requires human approval (BR-19)',
    };
  },
};

/**
 * POLICY_FINANCE_BUDGET_STATE — an expense cannot be claimed against a
 * closed budget (previously discovered only AFTER approval, at execution),
 * and a budget that cannot be resolved inside the trusted workspace fails
 * closed instead of opening an approval for an action that cannot succeed.
 */
export const financeBudgetStateRule: PolicyRule = {
  id: POLICY_IDS.FINANCE_BUDGET_STATE,
  version: '1',
  evaluate(request): RuleVerdict | undefined {
    if (!isExpense(request)) {
      return undefined;
    }
    const budget = request.facts.budget;
    if (budget === undefined || budget.state === 'unresolvable') {
      return {
        outcome: 'DENY',
        reasonCode: 'BUDGET_UNRESOLVABLE',
        reason: 'The budget could not be resolved in the trusted workspace',
      };
    }
    if (budget.value.status === 'closed') {
      return {
        outcome: 'DENY',
        reasonCode: 'BUDGET_CLOSED',
        reason: 'Expenses cannot be submitted against a closed budget',
        constraints: { budgetStatus: 'closed' },
      };
    }
    if (budget.value.status === 'under_review') {
      return {
        outcome: 'REQUIRE_APPROVAL',
        reasonCode: 'BUDGET_UNDER_REVIEW',
        reason: 'The budget is under review; expenses need human approval',
        constraints: { budgetStatus: 'under_review' },
      };
    }
    return undefined;
  },
};

/** The validated configuration of POLICY_FINANCE_BUDGET_LIMIT. */
export interface BudgetLimitConfig {
  /** What happens when an expense would push approved spend over the allocation. */
  mode: 'deny' | 'require_approval';
}

/**
 * Parses a persisted budget-limit configuration (lenient about extra keys so a
 * stored value never silently stops applying; the write-side validator in
 * `config-validation.ts` is strict).
 */
export function parseBudgetLimitConfig(raw: unknown): BudgetLimitConfig | undefined {
  if (typeof raw !== 'object' || raw === null) {
    return undefined;
  }
  const mode = (raw as Record<string, unknown>)['mode'];
  return mode === 'deny' || mode === 'require_approval' ? { mode } : undefined;
}

/**
 * POLICY_FINANCE_BUDGET_LIMIT — OPT-IN, per organization. When the
 * organization has configured it, an expense that would push the budget's
 * approved spend above its allocation is denied (or, in the other mode,
 * flagged for approval). With no configuration the rule does not apply, so
 * default behaviour is unchanged. A configuration that cannot be understood
 * fails closed (DENY) — a broken policy never silently becomes "no policy".
 */
export const financeBudgetLimitRule: PolicyRule = {
  id: POLICY_IDS.FINANCE_BUDGET_LIMIT,
  version: '1',
  evaluate(request): RuleVerdict | undefined {
    if (!isExpense(request)) {
      return undefined;
    }
    const entry = request.facts.configs[POLICY_IDS.FINANCE_BUDGET_LIMIT];
    if (entry === undefined || entry.enabled === false) {
      return undefined;
    }
    const version = `${this.version}+config.${entry.version}`;
    const config = parseBudgetLimitConfig(entry.config);
    if (config === undefined) {
      return {
        outcome: 'DENY',
        reasonCode: 'POLICY_CONFIGURATION_INVALID',
        reason: 'The organization policy configuration is invalid; failing closed',
        version,
      };
    }
    const budget = request.facts.budget;
    const amount = amountOf(request);
    if (budget === undefined || budget.state === 'unresolvable' || amount === undefined) {
      return {
        outcome: 'DENY',
        reasonCode: 'POLICY_CONTEXT_INCOMPLETE',
        reason: 'The budget or amount needed to evaluate the budget limit is unavailable',
        version,
      };
    }
    const fact: BudgetFact = budget.value;
    if (fact.currency.toUpperCase() !== String(request.input['currency'] ?? '').toUpperCase()) {
      return {
        outcome: 'DENY',
        reasonCode: 'CURRENCY_MISMATCH',
        reason: 'The expense currency differs from the budget currency',
        version,
      };
    }
    const projected = fact.spentMinorUnits + amount;
    if (projected <= fact.allocatedMinorUnits) {
      return {
        outcome: 'ALLOW',
        reasonCode: 'WITHIN_BUDGET',
        reason: 'The expense keeps the budget within its allocation',
        version,
        constraints: {
          allocatedMinorUnits: fact.allocatedMinorUnits,
          projectedMinorUnits: projected,
        },
      };
    }
    return {
      outcome: config.mode === 'deny' ? 'DENY' : 'REQUIRE_APPROVAL',
      reasonCode: 'BUDGET_OVERRUN',
      reason: 'The expense would push the budget over its allocation',
      version,
      constraints: {
        allocatedMinorUnits: fact.allocatedMinorUnits,
        projectedMinorUnits: projected,
        mode: config.mode,
      },
    };
  },
};
