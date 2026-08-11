/**
 * @nexora/domain-projects — AssignmentId value object.
 *
 * The identity of a {@link ResourceAssignment} (contracts
 * `EntityId<'assignment'>`). Values are branded strings (`asg_...`) created
 * with `@nexora/shared/ids` {@link prefixedId} (PERSISTENCE.md §1 aggregate
 * ownership).
 */

import type { EntityId } from '@nexora/contracts/common';
import { prefixedId } from '@nexora/shared/ids';

import { InvalidProjectValueError } from '../errors/index.js';

/**
 * Assignment id literal pattern: `asg_` + RFC-4122 UUID v4 (the `prefixedId`
 * shape).
 */
const ASSIGNMENT_ID_PATTERN = /^asg_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * A branded assignment id. Strings with this brand satisfy the type; values
 * are produced by the {@link AssignmentId} namespace below or by
 * infrastructure reconstruction via {@link AssignmentId.from}.
 */
export type AssignmentId = EntityId<'assignment'>;

/**
 * Factory for {@link AssignmentId} values. The type and namespace share a
 * name so call sites read naturally: `AssignmentId.create()`.
 */
export const AssignmentId = {
  /** Generates a new unique assignment id (`asg_...`). */
  create(): AssignmentId {
    return prefixedId('asg') as AssignmentId;
  },

  /**
   * Reconstructs an {@link AssignmentId} from a stored string
   * (infrastructure boundary).
   *
   * @param value - an id previously produced by {@link AssignmentId.create}.
   * @throws {InvalidProjectValueError} when the value is not a valid id.
   */
  from(value: string): AssignmentId {
    if (!ASSIGNMENT_ID_PATTERN.test(value)) {
      throw new InvalidProjectValueError('Invalid assignment id', [
        { path: 'assignmentId', message: 'Must be a valid assignment id' },
      ]);
    }
    return value as AssignmentId;
  },
};
