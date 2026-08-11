/**
 * Domain policy tests: lifecycle transitions, archival rules, membership
 * invariants, installation rules, binding gating, and slug uniqueness.
 */

import { describe, expect, it } from 'vitest';

import {
  LastOwnerRemovalError,
  SlugAlreadyExistsError,
  WorkspaceArchivedError,
  WorkspaceNotActiveError,
  WorkspaceStateTransitionError,
  InvalidWorkspaceValueError,
} from '../src/errors/index.js';
import {
  WORKSPACE_TRANSITIONS,
  WorkspaceArchivalPolicy,
  WorkspaceBindingPolicy,
  WorkspaceInstallationPolicy,
  WorkspaceLifecyclePolicy,
  WorkspaceMembershipPolicy,
  SlugUniquenessPolicy,
} from '../src/policies/index.js';
import { WorkspaceStatus } from '../src/value-objects/workspace-status.js';

const lifecycle = new WorkspaceLifecyclePolicy();
const archival = new WorkspaceArchivalPolicy();
const membership = new WorkspaceMembershipPolicy();
const installation = new WorkspaceInstallationPolicy();
const binding = new WorkspaceBindingPolicy();
const slugPolicy = new SlugUniquenessPolicy();

describe('WORKSPACE_TRANSITIONS', () => {
  it('defines the canonical transition table', () => {
    expect(WORKSPACE_TRANSITIONS.provisioning).toEqual(['active']);
    expect(WORKSPACE_TRANSITIONS.active).toEqual(['suspended', 'archived']);
    expect(WORKSPACE_TRANSITIONS.suspended).toEqual(['active', 'archived']);
    expect(WORKSPACE_TRANSITIONS.archived).toEqual([]);
  });

  it('archived is terminal', () => {
    expect(WORKSPACE_TRANSITIONS.archived).toHaveLength(0);
  });
});

describe('WorkspaceLifecyclePolicy', () => {
  it('reports the allowed targets for a status', () => {
    expect(lifecycle.allowedTargets(WorkspaceStatus.active())).toEqual(['suspended', 'archived']);
  });

  it('permits allowed transitions', () => {
    expect(() =>
      lifecycle.assertCanTransition(WorkspaceStatus.provisioning(), WorkspaceStatus.active()),
    ).not.toThrow();
    expect(() =>
      lifecycle.assertCanTransition(WorkspaceStatus.suspended(), WorkspaceStatus.active()),
    ).not.toThrow();
  });

  it('rejects forbidden transitions', () => {
    expect(() =>
      lifecycle.assertCanTransition(WorkspaceStatus.provisioning(), WorkspaceStatus.suspended()),
    ).toThrow(WorkspaceStateTransitionError);
    expect(() =>
      lifecycle.assertCanTransition(WorkspaceStatus.archived(), WorkspaceStatus.active()),
    ).toThrow(WorkspaceStateTransitionError);
  });

  it('assertCanExecuteWorkflows passes only for active workspaces', () => {
    expect(() => lifecycle.assertCanExecuteWorkflows(WorkspaceStatus.active())).not.toThrow();
  });

  it('assertCanExecuteWorkflows rejects non-active workspaces', () => {
    for (const status of [
      WorkspaceStatus.provisioning(),
      WorkspaceStatus.suspended(),
      WorkspaceStatus.archived(),
    ]) {
      expect(() => lifecycle.assertCanExecuteWorkflows(status)).toThrow(WorkspaceNotActiveError);
    }
  });
});

describe('WorkspaceArchivalPolicy', () => {
  it('permits archival from active and suspended', () => {
    expect(() => archival.assertCanArchive(WorkspaceStatus.active())).not.toThrow();
    expect(() => archival.assertCanArchive(WorkspaceStatus.suspended())).not.toThrow();
  });

  it('rejects archival from provisioning and archived', () => {
    expect(() => archival.assertCanArchive(WorkspaceStatus.provisioning())).toThrow(
      WorkspaceStateTransitionError,
    );
    expect(() => archival.assertCanArchive(WorkspaceStatus.archived())).toThrow(
      WorkspaceStateTransitionError,
    );
  });

  it('assertCanMutate rejects only archived workspaces', () => {
    expect(() => archival.assertCanMutate(WorkspaceStatus.active())).not.toThrow();
    expect(() => archival.assertCanMutate(WorkspaceStatus.suspended())).not.toThrow();
    expect(() => archival.assertCanMutate(WorkspaceStatus.provisioning())).not.toThrow();
    expect(() => archival.assertCanMutate(WorkspaceStatus.archived())).toThrow(
      WorkspaceArchivedError,
    );
  });
});

describe('WorkspaceMembershipPolicy', () => {
  it('accepts the canonical roles', () => {
    for (const role of ['owner', 'admin', 'member'] as const) {
      expect(() => membership.assertValidRole(role)).not.toThrow();
    }
  });

  it('rejects unknown roles', () => {
    expect(() => membership.assertValidRole('boss' as never)).toThrow(InvalidWorkspaceValueError);
  });

  it('assertCanAddMember requires an active workspace', () => {
    expect(() => membership.assertCanAddMember(WorkspaceStatus.active())).not.toThrow();
    expect(() => membership.assertCanAddMember(WorkspaceStatus.provisioning())).toThrow(
      WorkspaceNotActiveError,
    );
    expect(() => membership.assertCanAddMember(WorkspaceStatus.suspended())).toThrow(
      WorkspaceNotActiveError,
    );
  });

  it('assertCanAddMember rejects archived workspaces as immutable', () => {
    expect(() => membership.assertCanAddMember(WorkspaceStatus.archived())).toThrow(
      WorkspaceArchivedError,
    );
  });

  it('assertCanRemoveMember allows active and suspended but not archived', () => {
    expect(() => membership.assertCanRemoveMember(WorkspaceStatus.active())).not.toThrow();
    expect(() => membership.assertCanRemoveMember(WorkspaceStatus.suspended())).not.toThrow();
    expect(() => membership.assertCanRemoveMember(WorkspaceStatus.archived())).toThrow(
      WorkspaceArchivedError,
    );
  });

  it('assertCanRemoveOwner rejects removing the last owner', () => {
    expect(() => membership.assertCanRemoveOwner(2)).not.toThrow();
    expect(() => membership.assertCanRemoveOwner(1)).toThrow(LastOwnerRemovalError);
    expect(() => membership.assertCanRemoveOwner(0)).toThrow(LastOwnerRemovalError);
  });
});

describe('WorkspaceInstallationPolicy', () => {
  it('assertCanInstall requires an active workspace', () => {
    expect(() => installation.assertCanInstall(WorkspaceStatus.active())).not.toThrow();
    expect(() => installation.assertCanInstall(WorkspaceStatus.provisioning())).toThrow(
      WorkspaceNotActiveError,
    );
    expect(() => installation.assertCanInstall(WorkspaceStatus.suspended())).toThrow(
      WorkspaceNotActiveError,
    );
  });

  it('assertCanInstall rejects archived workspaces as immutable', () => {
    expect(() => installation.assertCanInstall(WorkspaceStatus.archived())).toThrow(
      WorkspaceArchivedError,
    );
  });

  it('assertCanRemoveInstallation allows non-archived workspaces', () => {
    expect(() => installation.assertCanRemoveInstallation(WorkspaceStatus.active())).not.toThrow();
    expect(() =>
      installation.assertCanRemoveInstallation(WorkspaceStatus.suspended()),
    ).not.toThrow();
    expect(() => installation.assertCanRemoveInstallation(WorkspaceStatus.archived())).toThrow(
      WorkspaceArchivedError,
    );
  });
});

describe('WorkspaceBindingPolicy', () => {
  it('assertCanChangeBindings rejects only archived workspaces', () => {
    expect(() => binding.assertCanChangeBindings(WorkspaceStatus.active())).not.toThrow();
    expect(() => binding.assertCanChangeBindings(WorkspaceStatus.suspended())).not.toThrow();
    expect(() => binding.assertCanChangeBindings(WorkspaceStatus.provisioning())).not.toThrow();
    expect(() => binding.assertCanChangeBindings(WorkspaceStatus.archived())).toThrow(
      WorkspaceArchivedError,
    );
  });
});

describe('SlugUniquenessPolicy', () => {
  it('accepts an available slug', () => {
    expect(() => slugPolicy.assertSlugAvailable(false)).not.toThrow();
  });

  it('rejects a taken slug', () => {
    expect(() => slugPolicy.assertSlugAvailable(true)).toThrow(SlugAlreadyExistsError);
  });
});
