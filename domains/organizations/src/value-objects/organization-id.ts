/**
 * @nexora/domain-organizations — OrganizationId value object.
 *
 * The identity of an {@link Organization}. In this bounded context the
 * Organization IS the tenant: `OrganizationId` is the domain name for the
 * tenant identifier (contracts `TenantId`), mapped 1:1 at the infrastructure
 * boundary. Values are branded strings (`org_...`) created with
 * `@nexora/shared/ids` {@link prefixedId}.
 */

import type { EntityId } from '@nexora/contracts/common';
import { prefixedId } from '@nexora/shared/ids';

import { InvalidOrganizationValueError } from '../errors/index.js';

/**
 * Organization id literal pattern: `org_` + RFC-4122 UUID v4 (the `prefixedId`
 * shape, PERSISTENCE.md §1).
 */
const ORGANIZATION_ID_PATTERN =
  /^org_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * A branded organization id. Strings with this brand satisfy the type; values
 * are produced by the {@link OrganizationId} namespace below or by
 * infrastructure reconstruction via {@link OrganizationId.from}.
 */
export type OrganizationId = EntityId<'organization'>;

/**
 * Factory for {@link OrganizationId} values. The type and namespace share a
 * name so call sites read naturally: `OrganizationId.create()`.
 */
export const OrganizationId = {
  /** Generates a new unique organization id (`org_...`). */
  create(): OrganizationId {
    return prefixedId('org') as OrganizationId;
  },

  /**
   * Reconstructs an {@link OrganizationId} from a stored string
   * (infrastructure boundary).
   *
   * @param value - an id previously produced by {@link OrganizationId.create}.
   * @throws {InvalidOrganizationValueError} when the value is not a valid id.
   */
  from(value: string): OrganizationId {
    if (!ORGANIZATION_ID_PATTERN.test(value)) {
      throw new InvalidOrganizationValueError('Invalid organization id', [
        { path: 'organizationId', message: 'Must be a valid organization id' },
      ]);
    }
    return value as OrganizationId;
  },
};
