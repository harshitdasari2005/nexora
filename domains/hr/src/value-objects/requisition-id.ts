/**
 * @nexora/domain-hr — RequisitionId value object.
 *
 * The identity of a {@link HiringRequisition} (`req_` + UUID v4, produced by
 * `@nexora/shared/ids`).
 */

import type { EntityId } from '@nexora/contracts/common';
import { prefixedId } from '@nexora/shared/ids';

import { InvalidEmployeeValueError } from '../errors/index.js';

const REQUISITION_ID_PATTERN = /^req_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** A branded hiring-requisition id. */
export type RequisitionId = EntityId<'hiring_requisition'>;

/** Factory for {@link RequisitionId} values. */
export const RequisitionId = {
  /** Generates a new unique requisition id (`req_...`). */
  create(): RequisitionId {
    return prefixedId('req') as RequisitionId;
  },

  /**
   * Reconstructs a {@link RequisitionId} from a stored or client-supplied string.
   *
   * @throws {InvalidEmployeeValueError} when the value is not a valid id.
   */
  from(value: string): RequisitionId {
    if (!REQUISITION_ID_PATTERN.test(value)) {
      throw new InvalidEmployeeValueError('Invalid requisition id', [
        { path: 'requisitionId', message: 'Must be a valid requisition id' },
      ]);
    }
    return value as RequisitionId;
  },
};
