/**
 * @nexora/domain-organizations — entities barrel.
 */

export { Organization, type CreateOrganizationInput } from './organization.js';
export {
  OrganizationProfile,
  type OrganizationProfileUpdate,
  MAX_DESCRIPTION_LENGTH,
  MAX_WEBSITE_LENGTH,
  MAX_CONTACT_EMAIL_LENGTH,
} from './organization-profile.js';
export {
  OrganizationSettings,
  type OrganizationSettingsUpdate,
  DEFAULT_ORGANIZATION_SETTINGS,
  MIN_RETENTION_DAYS,
  MAX_RETENTION_DAYS,
} from './organization-settings.js';
export {
  OrganizationMembership,
  MEMBERSHIP_ROLES,
  type MembershipRole,
  type AddMemberInput,
} from './organization-membership.js';
