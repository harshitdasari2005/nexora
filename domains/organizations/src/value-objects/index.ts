/**
 * @nexora/domain-organizations — value objects barrel.
 */

export { OrganizationId } from './organization-id.js';
export { OrganizationName, MAX_ORGANIZATION_NAME_LENGTH } from './organization-name.js';
export { OrganizationSlug, MIN_SLUG_LENGTH, MAX_SLUG_LENGTH } from './organization-slug.js';
export {
  OrganizationStatus,
  ORGANIZATION_STATUSES,
  type OrganizationStatusValue,
} from './organization-status.js';
export {
  OrganizationType,
  ORGANIZATION_TYPES,
  type OrganizationTypeValue,
} from './organization-type.js';
export { MEMBERSHIP_ROLES, type MembershipRole } from './membership-role.js';
