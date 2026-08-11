/**
 * @nexora/domain-workspaces — WorkspaceId value object.
 *
 * The identity of a {@link Workspace} (contracts `WorkspaceId`). Values are
 * branded strings (`wsp_...`) created with `@nexora/shared/ids`
 * {@link prefixedId} (PERSISTENCE.md §1 aggregate ownership).
 */

import type { EntityId } from '@nexora/contracts/common';
import { prefixedId } from '@nexora/shared/ids';

import { InvalidWorkspaceValueError } from '../errors/index.js';

/**
 * Workspace id literal pattern: `wsp_` + RFC-4122 UUID v4 (the `prefixedId`
 * shape).
 */
const WORKSPACE_ID_PATTERN = /^wsp_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * A branded workspace id. Strings with this brand satisfy the type; values
 * are produced by the {@link WorkspaceId} namespace below or by
 * infrastructure reconstruction via {@link WorkspaceId.from}.
 */
export type WorkspaceId = EntityId<'workspace'>;

/**
 * Factory for {@link WorkspaceId} values. The type and namespace share a name
 * so call sites read naturally: `WorkspaceId.create()`.
 */
export const WorkspaceId = {
  /** Generates a new unique workspace id (`wsp_...`). */
  create(): WorkspaceId {
    return prefixedId('wsp') as WorkspaceId;
  },

  /**
   * Reconstructs a {@link WorkspaceId} from a stored string
   * (infrastructure boundary).
   *
   * @param value - an id previously produced by {@link WorkspaceId.create}.
   * @throws {InvalidWorkspaceValueError} when the value is not a valid id.
   */
  from(value: string): WorkspaceId {
    if (!WORKSPACE_ID_PATTERN.test(value)) {
      throw new InvalidWorkspaceValueError('Invalid workspace id', [
        { path: 'workspaceId', message: 'Must be a valid workspace id' },
      ]);
    }
    return value as WorkspaceId;
  },
};
