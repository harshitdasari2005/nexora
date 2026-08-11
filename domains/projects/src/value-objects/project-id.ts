/**
 * @nexora/domain-projects — ProjectId value object.
 *
 * The identity of a {@link Project} (contracts `EntityId<'project'>`).
 * Values are branded strings (`prj_...`) created with `@nexora/shared/ids`
 * {@link prefixedId} (PERSISTENCE.md §1 aggregate ownership).
 */

import type { EntityId } from '@nexora/contracts/common';
import { prefixedId } from '@nexora/shared/ids';

import { InvalidProjectValueError } from '../errors/index.js';

/**
 * Project id literal pattern: `prj_` + RFC-4122 UUID v4 (the `prefixedId`
 * shape).
 */
const PROJECT_ID_PATTERN = /^prj_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * A branded project id. Strings with this brand satisfy the type; values
 * are produced by the {@link ProjectId} namespace below or by
 * infrastructure reconstruction via {@link ProjectId.from}.
 */
export type ProjectId = EntityId<'project'>;

/**
 * Factory for {@link ProjectId} values. The type and namespace share a name
 * so call sites read naturally: `ProjectId.create()`.
 */
export const ProjectId = {
  /** Generates a new unique project id (`prj_...`). */
  create(): ProjectId {
    return prefixedId('prj') as ProjectId;
  },

  /**
   * Reconstructs a {@link ProjectId} from a stored string
   * (infrastructure boundary).
   *
   * @param value - an id previously produced by {@link ProjectId.create}.
   * @throws {InvalidProjectValueError} when the value is not a valid id.
   */
  from(value: string): ProjectId {
    if (!PROJECT_ID_PATTERN.test(value)) {
      throw new InvalidProjectValueError('Invalid project id', [
        { path: 'projectId', message: 'Must be a valid project id' },
      ]);
    }
    return value as ProjectId;
  },
};
