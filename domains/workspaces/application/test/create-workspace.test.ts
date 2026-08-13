/**
 * CreateWorkspace use-case tests: provision (create → activate → owner)
 * flow, event publishing, and failure paths.
 */

import { describe, expect, it } from 'vitest';
import type { TenantId, UserId } from '@nexora/contracts/common';
import { ValidationError } from '@nexora/shared/errors';

import {
  SlugAlreadyExistsError,
  WorkspaceDomainService,
  WorkspaceInstallationService,
  WorkspaceMembershipService,
  WORKSPACE_EVENT_TYPES,
} from '@nexora/domain-workspaces';

import type { CreateWorkspaceCommand } from '../src/commands/create-workspace.command.js';
import { WorkspaceApplicationService } from '../src/services/workspace-application-service.js';
import {
  InMemoryWorkspaceInstallationRepository,
  InMemoryWorkspaceMembershipRepository,
  InMemoryWorkspaceRepository,
  RecordingEventPublisher,
} from './helpers.js';

const ORG = 'org_acme' as TenantId;
const ACTOR = 'usr_alex' as UserId;

function makeEnvironment() {
  const workspaces = new InMemoryWorkspaceRepository();
  const memberships = new InMemoryWorkspaceMembershipRepository();
  const publisher = new RecordingEventPublisher();

  const workspacesService = new WorkspaceDomainService({ workspaces });
  const membershipsService = new WorkspaceMembershipService({ memberships, workspaces });
  const installationsService = new WorkspaceInstallationService({
    installations: new InMemoryWorkspaceInstallationRepository(),
    workspaces,
  });
  const service = new WorkspaceApplicationService({
    workspacesService,
    membershipsService,
    installationsService,
    publisher,
  });
  return { service, workspaces, memberships, publisher };
}

function command(overrides: Partial<CreateWorkspaceCommand> = {}): CreateWorkspaceCommand {
  return {
    organizationId: ORG,
    slug: 'engineering',
    name: 'Engineering',
    type: 'engineering',
    actorId: ACTOR,
    correlationId: 'corr_ws_1',
    ...overrides,
  };
}

describe('WorkspaceApplicationService.createWorkspace', () => {
  it('provisions an active workspace with the creator as first owner', async () => {
    const { service, workspaces, memberships, publisher } = makeEnvironment();
    const result = await service.createWorkspace(command());

    expect(result.ok).toBe(true);
    if (result.ok) {
      const workspace = workspaces.workspaces.get(result.value.workspace.id);
      expect(workspace).toBeDefined();
      expect(workspace?.status.value).toBe('active');
      expect(workspace?.name.value).toBe('Engineering');
      expect(workspace?.organizationId).toBe(ORG);
      const membership = memberships.memberships.get(result.value.membership.id);
      expect(membership?.userId).toBe(ACTOR);
      expect(membership?.role).toBe('owner');
    }
    expect(publisher.types).toEqual([
      WORKSPACE_EVENT_TYPES.workspaceCreated,
      WORKSPACE_EVENT_TYPES.workspaceActivated,
      WORKSPACE_EVENT_TYPES.memberAdded,
    ]);
  });

  it('rejects a duplicate slug within the organization', async () => {
    const { service } = makeEnvironment();
    const first = await service.createWorkspace(command());
    expect(first.ok).toBe(true);

    const second = await service.createWorkspace(command({ correlationId: 'corr_ws_2' }));
    expect(second.ok).toBe(false);
    if (!second.ok) {
      expect(second.error).toBeInstanceOf(SlugAlreadyExistsError);
    }
  });

  it('allows the same slug in a different organization (scoped uniqueness)', async () => {
    const { service } = makeEnvironment();
    const first = await service.createWorkspace(command());
    expect(first.ok).toBe(true);

    const other = await service.createWorkspace(
      command({ organizationId: 'org_beta' as TenantId, correlationId: 'corr_ws_3' }),
    );
    expect(other.ok).toBe(true);
  });

  it('rejects an unknown workspace type', async () => {
    const { service } = makeEnvironment();
    const result = await service.createWorkspace(command({ type: 'alien' }));
    // The command validator rejects unknown types before the domain runs.
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBeInstanceOf(ValidationError);
    }
  });

  it('rejects a malformed command with a ValidationError', async () => {
    const { service } = makeEnvironment();
    const result = await service.createWorkspace(command({ slug: '!!bad slug!!', type: 'nope' }));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBeInstanceOf(ValidationError);
    }
  });

  it('publishes nothing when provisioning fails midway', async () => {
    const { service, publisher } = makeEnvironment();
    const result = await service.createWorkspace(command({ slug: '!!bad!!' }));
    expect(result.ok).toBe(false);
    expect(publisher.types).toHaveLength(0);
  });
});
