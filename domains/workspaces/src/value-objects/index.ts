/**
 * @nexora/domain-workspaces — value objects barrel.
 */

export { WorkspaceId } from './workspace-id.js';
export { WorkspaceName, MAX_WORKSPACE_NAME_LENGTH } from './workspace-name.js';
export { WorkspaceSlug, MIN_SLUG_LENGTH, MAX_SLUG_LENGTH } from './workspace-slug.js';
export {
  WorkspaceStatus,
  WORKSPACE_STATUSES,
  type WorkspaceStatusValue,
} from './workspace-status.js';
export {
  WorkspaceVisibility,
  WORKSPACE_VISIBILITIES,
  type WorkspaceVisibilityValue,
} from './workspace-visibility.js';
export { WorkspaceType, WORKSPACE_TYPES, type WorkspaceTypeValue } from './workspace-type.js';
export { WorkspaceColor } from './workspace-color.js';
export { WorkspaceIcon, MAX_ICON_LENGTH } from './workspace-icon.js';
export { WorkspaceTimeZone, MAX_TIME_ZONE_LENGTH } from './workspace-time-zone.js';
export { WorkspaceLocale } from './workspace-locale.js';
export { MEMBERSHIP_ROLES, type MembershipRole } from './membership-role.js';
