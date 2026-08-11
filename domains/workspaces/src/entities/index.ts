/**
 * @nexora/domain-workspaces — entities barrel.
 */

export { Workspace, type CreateWorkspaceInput } from './workspace.js';
export {
  WorkspaceSettings,
  type WorkspaceSettingsUpdate,
  DEFAULT_WORKSPACE_SETTINGS,
} from './workspace-settings.js';
export {
  WorkspaceBranding,
  type WorkspaceBrandingUpdate,
  DEFAULT_WORKSPACE_BRANDING,
} from './workspace-branding.js';
export {
  WorkspacePreferences,
  type WorkspacePreferencesUpdate,
  WORKSPACE_THEMES,
  WORKSPACE_DENSITIES,
  DEFAULT_WORKSPACE_PREFERENCES,
} from './workspace-preferences.js';
export { WorkspaceFeature } from './workspace-feature.js';
export { WorkspaceAgentBinding } from './workspace-agent-binding.js';
export { WorkspaceKnowledgeBinding } from './workspace-knowledge-binding.js';
export { WorkspaceWorkflowBinding } from './workspace-workflow-binding.js';
export { WorkspaceSearchBinding } from './workspace-search-binding.js';
export { WorkspaceNotificationBinding } from './workspace-notification-binding.js';
export { WorkspaceMembership, type AddMemberInput } from './workspace-membership.js';
export { WorkspaceInstallation, type InstallPluginInput } from './workspace-installation.js';
