/**
 * @nexora/module-finance — BudgetId value object.
 *
 * The identity of a {@link Budget} (contracts `EntityId<'budget'>`). Values
 * are branded strings (`bud_...`) created with `@nexora/shared/ids`
 * {@link prefixedId} (PERSISTENCE.md §1 aggregate ownership).
 */

import type { EntityId } from '@nexora/contracts/common';
import { prefixedId } from '@nexora/shared/ids';

import { InvalidFinanceValueError } from '../errors/index.js';

/** Budget id literal pattern: `bud_` + RFC-4122 UUID v4 (the `prefixedId` shape). */
const BUDGET_ID_PATTERN = /^bud_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * A branded budget id. Strings with this brand satisfy the type; values are
 * produced by the {@link BudgetId} namespace below or by infrastructure
 * reconstruction via {@link BudgetId.from}.
 */
export type BudgetId = EntityId<'budget'>;

/**
 * Factory for {@link BudgetId} values. The type and namespace share a name
 * so call sites read naturally: `BudgetId.create()`.
 */
export const BudgetId = {
  /** Generates a new unique budget id (`bud_...`). */
  create(): BudgetId {
    return prefixedId('bud') as BudgetId;
  },

  /**
   * Reconstructs a {@link BudgetId} from a stored string (infrastructure
   * boundary).
   *
   * @param value - an id previously produced by {@link BudgetId.create}.
   * @throws {InvalidFinanceValueError} when the value is not a valid id.
   */
  from(value: string): BudgetId {
    if (!BUDGET_ID_PATTERN.test(value)) {
      throw new InvalidFinanceValueError('Invalid budget id', [
        { path: 'budgetId', message: 'Must be a valid budget id' },
      ]);
    }
    return value as BudgetId;
  },
};
