/**
 * @nexora/module-finance — ExpenseId value object.
 *
 * The identity of an {@link Expense} (contracts `EntityId<'expense'>`).
 * Values are branded strings (`exp_...`) created with `@nexora/shared/ids`
 * {@link prefixedId} (PERSISTENCE.md §1 aggregate ownership).
 */

import type { EntityId } from '@nexora/contracts/common';
import { prefixedId } from '@nexora/shared/ids';

import { InvalidFinanceValueError } from '../errors/index.js';

/** Expense id literal pattern: `exp_` + RFC-4122 UUID v4 (the `prefixedId` shape). */
const EXPENSE_ID_PATTERN = /^exp_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * A branded expense id. Strings with this brand satisfy the type; values are
 * produced by the {@link ExpenseId} namespace below or by infrastructure
 * reconstruction via {@link ExpenseId.from}.
 */
export type ExpenseId = EntityId<'expense'>;

/**
 * Factory for {@link ExpenseId} values. The type and namespace share a name
 * so call sites read naturally: `ExpenseId.create()`.
 */
export const ExpenseId = {
  /** Generates a new unique expense id (`exp_...`). */
  create(): ExpenseId {
    return prefixedId('exp') as ExpenseId;
  },

  /**
   * Reconstructs an {@link ExpenseId} from a stored string (infrastructure
   * boundary).
   *
   * @param value - an id previously produced by {@link ExpenseId.create}.
   * @throws {InvalidFinanceValueError} when the value is not a valid id.
   */
  from(value: string): ExpenseId {
    if (!EXPENSE_ID_PATTERN.test(value)) {
      throw new InvalidFinanceValueError('Invalid expense id', [
        { path: 'expenseId', message: 'Must be a valid expense id' },
      ]);
    }
    return value as ExpenseId;
  },
};
