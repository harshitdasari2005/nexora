/**
 * @nexora/domain-workspaces — services barrel.
 */

export {
  WorkspaceDomainService,
  type WorkspaceDomainServiceDependencies,
  type CreateWorkspaceCommand,
  type WorkspaceCommandResult,
} from './workspace-domain-service.js';
export {
  WorkspaceMembershipService,
  type WorkspaceMembershipServiceDependencies,
  type MembershipCommandResult,
} from './workspace-membership-service.js';
export {
  WorkspaceInstallationService,
  type WorkspaceInstallationServiceDependencies,
  type InstallationCommandResult,
} from './workspace-installation-service.js';
export {
  WorkspacePolicyService,
  type WorkspacePolicyServiceDependencies,
} from './workspace-policy-service.js';
