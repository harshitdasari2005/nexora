/**
 * WorkspacePolicyService tests: the policy evaluation façade — throwing vs
 * boolean variants for lifecycle, archival, membership, installation,
 * binding, and slug checks.
 */

import { describe, expect, it } from 'vitest';
import type { TenantId } from '@nexora/contracts/common';

import {
  InvalidWorkspaceValueError,
  LastOwnerRemovalError,
  SlugAlreadyExistsError,
  WorkspaceArchivedError,
  WorkspaceNotActiveError,
  WorkspaceStateTransitionError,
} from '../src/errors/index.js';
import { Workspace } from '../src/entities/workspace.js';
import { WorkspacePolicyService } from '../src/services/workspace-policy-service.js';
import { WorkspaceSlug } from '../src/value-objects/workspace-slug.js';
import { WorkspaceStatus } from '../src/value-objects/workspace-status.js';
import { WorkspaceType } from '../src/value-objects/workspace-type.js';
import { testContext } from './helpers.js';

const ORGANIZATION = 'tenant_1' as TenantId;
const context = testContext();
const service = new WorkspacePolicyService();

function createWorkspace(status: WorkspaceStatus = WorkspaceStatus.active()): Workspace {
  return Workspace.create(
    {
      organizationId: ORGANIZATION,
      slug: WorkspaceSlug.create('eng'),
      name: 'Engineering',
      type: WorkspaceType.engineering(),
      status,
    },
    context,
  );
}

describe('WorkspacePolicyService workflow eligibility', () => {
  it('canExecuteWorkflows is true only for active workspaces', () => {
    expect(service.canExecuteWorkflows(createWorkspace(WorkspaceStatus.active()))).toBe(true);
    expect(service.canExecuteWorkflows(createWorkspace(WorkspaceStatus.provisioning()))).toBe(
      false,
    );
    expect(service.canExecuteWorkflows(createWorkspace(WorkspaceStatus.suspended()))).toBe(false);
    expect(service.canExecuteWorkflows(createWorkspace(WorkspaceStatus.archived()))).toBe(false);
  });

  it('assertCanExecuteWorkflows throws only for non-active workspaces', () => {
    expect(() =>
      service.assertCanExecuteWorkflows(createWorkspace(WorkspaceStatus.active())),
    ).not.toThrow();
    expect(() =>
      service.assertCanExecuteWorkflows(createWorkspace(WorkspaceStatus.suspended())),
    ).toThrow(WorkspaceNotActiveError);
  });
});

describe('WorkspacePolicyService archival', () => {
  it('isArchived reflects the status', () => {
    expect(service.isArchived(createWorkspace(WorkspaceStatus.archived()))).toBe(true);
    expect(service.isArchived(createWorkspace(WorkspaceStatus.active()))).toBe(false);
  });

  it('assertCanMutate rejects archived workspaces', () => {
    expect(() => service.assertCanMutate(createWorkspace(WorkspaceStatus.active()))).not.toThrow();
    expect(() => service.assertCanMutate(createWorkspace(WorkspaceStatus.archived()))).toThrow(
      WorkspaceArchivedError,
    );
  });
});

describe('WorkspacePolicyService transitions', () => {
  it('assertCanTransition permits and rejects transitions', () => {
    expect(() =>
      service.assertCanTransition(
        createWorkspace(WorkspaceStatus.provisioning()),
        WorkspaceStatus.active(),
      ),
    ).not.toThrow();
    expect(() =>
      service.assertCanTransition(
        createWorkspace(WorkspaceStatus.provisioning()),
        WorkspaceStatus.archived(),
      ),
    ).toThrow(WorkspaceStateTransitionError);
  });
});

describe('WorkspacePolicyService membership', () => {
  it('canAddMember is true only for active workspaces', () => {
    expect(service.canAddMember(createWorkspace(WorkspaceStatus.active()))).toBe(true);
    expect(service.canAddMember(createWorkspace(WorkspaceStatus.suspended()))).toBe(false);
    expect(service.canAddMember(createWorkspace(WorkspaceStatus.archived()))).toBe(false);
  });

  it('assertCanAddMember throws for non-active workspaces', () => {
    expect(() =>
      service.assertCanAddMember(createWorkspace(WorkspaceStatus.active())),
    ).not.toThrow();
    expect(() =>
      service.assertCanAddMember(createWorkspace(WorkspaceStatus.provisioning())),
    ).toThrow(WorkspaceNotActiveError);
  });

  it('assertValidRole accepts canonical roles and rejects unknown ones', () => {
    for (const role of ['owner', 'admin', 'member'] as const) {
      expect(() => service.assertValidRole(role)).not.toThrow();
    }
    expect(() => service.assertValidRole('root' as never)).toThrow(InvalidWorkspaceValueError);
  });

  it('assertCanRemoveOwner protects the last owner', () => {
    expect(() => service.assertCanRemoveOwner(3)).not.toThrow();
    expect(() => service.assertCanRemoveOwner(1)).toThrow(LastOwnerRemovalError);
  });
});

describe('WorkspacePolicyService installation', () => {
  it('assertCanInstall requires an active workspace', () => {
    expect(() => service.assertCanInstall(createWorkspace(WorkspaceStatus.active()))).not.toThrow();
    expect(() => service.assertCanInstall(createWorkspace(WorkspaceStatus.suspended()))).toThrow(
      WorkspaceNotActiveError,
    );
    expect(() => service.assertCanInstall(createWorkspace(WorkspaceStatus.archived()))).toThrow(
      WorkspaceArchivedError,
    );
  });
});

describe('WorkspacePolicyService bindings', () => {
  it('assertCanChangeBindings rejects only archived workspaces', () => {
    expect(() =>
      service.assertCanChangeBindings(createWorkspace(WorkspaceStatus.active())),
    ).not.toThrow();
    expect(() =>
      service.assertCanChangeBindings(createWorkspace(WorkspaceStatus.archived())),
    ).toThrow(WorkspaceArchivedError);
  });
});

describe('WorkspacePolicyService slug uniqueness', () => {
  it('assertSlugAvailable accepts a free slug and rejects a taken one', () => {
    expect(() => service.assertSlugAvailable(false)).not.toThrow();
    expect(() => service.assertSlugAvailable(true)).toThrow(SlugAlreadyExistsError);
  });
});
