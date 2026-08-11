/**
 * @nexora/domain-hr — EmployeeId value object.
 *
 * The identity of an {@link Employee} (contracts `EntityId<'employee'>`).
 * Values are branded strings (`emp_...`) created with `@nexora/shared/ids`
 * {@link prefixedId} (PERSISTENCE.md §1 aggregate ownership).
 */

import type { EntityId } from '@nexora/contracts/common';
import { prefixedId } from '@nexora/shared/ids';

import { InvalidEmployeeValueError } from '../errors/index.js';

/**
 * Employee id literal pattern: `emp_` + RFC-4122 UUID v4 (the `prefixedId`
 * shape).
 */
const EMPLOYEE_ID_PATTERN = /^emp_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * A branded employee id. Strings with this brand satisfy the type; values
 * are produced by the {@link EmployeeId} namespace below or by
 * infrastructure reconstruction via {@link EmployeeId.from}.
 */
export type EmployeeId = EntityId<'employee'>;

/**
 * Factory for {@link EmployeeId} values. The type and namespace share a name
 * so call sites read naturally: `EmployeeId.create()`.
 */
export const EmployeeId = {
  /** Generates a new unique employee id (`emp_...`). */
  create(): EmployeeId {
    return prefixedId('emp') as EmployeeId;
  },

  /**
   * Reconstructs a {@link EmployeeId} from a stored string
   * (infrastructure boundary).
   *
   * @param value - an id previously produced by {@link EmployeeId.create}.
   * @throws {InvalidEmployeeValueError} when the value is not a valid id.
   */
  from(value: string): EmployeeId {
    if (!EMPLOYEE_ID_PATTERN.test(value)) {
      throw new InvalidEmployeeValueError('Invalid employee id', [
        { path: 'employeeId', message: 'Must be a valid employee id' },
      ]);
    }
    return value as EmployeeId;
  },
};
