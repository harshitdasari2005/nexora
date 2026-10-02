/**
 * @nexora/domain-hr — recruiting ids (job openings and candidates).
 */

import type { EntityId } from '@nexora/contracts/common';
import { prefixedId } from '@nexora/shared/ids';

import { InvalidEmployeeValueError } from '../errors/index.js';

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';

function idFactory<T extends string>(prefix: string, label: string) {
  const pattern = new RegExp(`^${prefix}_${UUID}$`);
  return {
    /** Generates a new unique id. */
    create(): EntityId<T> {
      return prefixedId(prefix) as EntityId<T>;
    },
    /** Reconstructs an id from a stored or client-supplied string. */
    from(value: string): EntityId<T> {
      if (!pattern.test(value)) {
        throw new InvalidEmployeeValueError(`Invalid ${label} id`, [
          { path: `${label}Id`, message: `Must be a valid ${label} id` },
        ]);
      }
      return value as EntityId<T>;
    },
  };
}

/** A branded job-opening id (`job_…`). */
export type JobOpeningId = EntityId<'job_opening'>;
export const JobOpeningId = idFactory<'job_opening'>('job', 'opening');

/** A branded candidate id (`cand_…`). */
export type CandidateId = EntityId<'candidate'>;
export const CandidateId = idFactory<'candidate'>('cand', 'candidate');
