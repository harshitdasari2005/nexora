/**
 * WorkspaceMembershipService tests: add/remove/change-role flows with
 * workspace-status gating, duplicate detection, and last-owner protection.
 */

import { describe, expect, it } from 'vitest';
import type { TenantId, UserId } from '@nexora/contracts/common';

import {
  InvalidWorkspaceValueError,
  LastOwnerRemovalError,
  MemberAlreadyExistsError,
  MemberNotFoundError,
  WorkspaceArchivedError,
  WorkspaceNotFoundError,
  WorkspaceNotActiveError,
} from '../src/errors/index.js';
import { WORKSPACE_EVENT_TYPES } from '../src/events/index.js';
import { WorkspaceDomainService } from '../src/services/workspace-domain-service.js';
import { WorkspaceMembershipService } from '../src/services/workspace-membership-service.js';
import { WorkspaceId } from '../src/value-objects/workspace-id.js';
import {
  InMemoryWorkspaceMembershipRepository,
  InMemoryWorkspaceRepository,
  testContext,
} from './helpers.js';

const ORGANIZATION = 'tenant_1' as TenantId;
const ALICE = 'usr_alice' as UserId;
const BOB = 'usr_bob' as UserId;
const context = testContext();

async function createService() {
  const workspaces = new InMemoryWorkspaceRepository();
  const memberships = new InMemoryWorkspaceMembershipRepository();
  const workspaceService = new WorkspaceDomainService({ workspaces });
  const service = new WorkspaceMembershipService({ memberships, workspaces });
  return { workspaces, memberships, workspaceService, service };
}

async function createActiveWorkspace(
  workspaceService: WorkspaceDomainService,
): Promise<WorkspaceId> {
  const created = await workspaceService.create(
    { organizationId: ORGANIZATION, slug: 'eng', name: 'Engineering', type: 'engineering' },
    context,
  );
  if (!created.ok) throw new Error('create failed');
  const activated = await workspaceService.activate(created.value.workspace.id, context);
  if (!activated.ok) throw new Error('activate failed');
  return activated.value.workspace.id;
}

describe('WorkspaceMembershipService.addMember', () => {
  it('adds a member to an active workspace and emits MemberAdded', async () => {
    const { service, workspaceService } = await createService();
    const id = await createActiveWorkspace(workspaceService);
    const result = await service.addMember(id, ALICE, 'member', context);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.membership.userId).toBe(ALICE);
    expect(result.value.membership.role).toBe('member');
    expect(result.value.events.map((event) => event.type)).toEqual([
      WORKSPACE_EVENT_TYPES.memberAdded,
    ]);
  });

  it('fails when the workspace does not exist', async () => {
    const { service } = await createService();
    const result = await service.addMember(WorkspaceId.create(), ALICE, 'member', context);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBeInstanceOf(WorkspaceNotFoundError);
  });

  it('fails when the workspace is not active', async () => {
    const { service, workspaceService } = await createService();
    const created = await workspaceService.create(
      { organizationId: ORGANIZATION, slug: 'eng', name: 'E', type: 'engineering' },
      context,
    );
    if (!created.ok) return;
    const result = await service.addMember(created.value.workspace.id, ALICE, 'member', context);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBeInstanceOf(WorkspaceNotActiveError);
  });

  it('fails when the workspace is archived', async () => {
    const { service, workspaceService } = await createService();
    const id = await createActiveWorkspace(workspaceService);
    await workspaceService.archive(id, 'done', context);
    const result = await service.addMember(id, ALICE, 'member', context);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBeInstanceOf(WorkspaceArchivedError);
  });

  it('fails when the user is already a member', async () => {
    const { service, workspaceService } = await createService();
    const id = await createActiveWorkspace(workspaceService);
    await service.addMember(id, ALICE, 'member', context);
    const result = await service.addMember(id, ALICE, 'admin', context);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBeInstanceOf(MemberAlreadyExistsError);
  });

  it('rejects an invalid role', async () => {
    const { service, workspaceService } = await createService();
    const id = await createActiveWorkspace(workspaceService);
    const result = await service.addMember(id, ALICE, 'boss' as never, context);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBeInstanceOf(InvalidWorkspaceValueError);
  });

  it('allows multiple members in the same workspace', async () => {
    const { service, workspaceService } = await createService();
    const id = await createActiveWorkspace(workspaceService);
    await service.addMember(id, ALICE, 'owner', context);
    const second = await service.addMember(id, BOB, 'member', context);
    expect(second.ok).toBe(true);
  });
});

describe('WorkspaceMembershipService.removeMember', () => {
  it('removes a member and emits MemberRemoved', async () => {
    const { service, workspaceService } = await createService();
    const id = await createActiveWorkspace(workspaceService);
    await service.addMember(id, ALICE, 'member', context);
    const result = await service.removeMember(id, ALICE, context);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.events.map((event) => event.type)).toEqual([
      WORKSPACE_EVENT_TYPES.memberRemoved,
    ]);
  });

  it('removes the membership from the repository', async () => {
    const { service, workspaceService, memberships } = await createService();
    const id = await createActiveWorkspace(workspaceService);
    await service.addMember(id, ALICE, 'member', context);
    await service.removeMember(id, ALICE, context);
    const remaining = await memberships.listByWorkspace(id);
    expect(remaining).toHaveLength(0);
  });

  it('fails when the membership does not exist', async () => {
    const { service, workspaceService } = await createService();
    const id = await createActiveWorkspace(workspaceService);
    const result = await service.removeMember(id, ALICE, context);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBeInstanceOf(MemberNotFoundError);
  });

  it('rejects removing the last owner', async () => {
    const { service, workspaceService } = await createService();
    const id = await createActiveWorkspace(workspaceService);
    await service.addMember(id, ALICE, 'owner', context);
    const result = await service.removeMember(id, ALICE, context);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBeInstanceOf(LastOwnerRemovalError);
  });

  it('allows removing an owner when another owner remains', async () => {
    const { service, workspaceService } = await createService();
    const id = await createActiveWorkspace(workspaceService);
    await service.addMember(id, ALICE, 'owner', context);
    await service.addMember(id, BOB, 'owner', context);
    const result = await service.removeMember(id, ALICE, context);
    expect(result.ok).toBe(true);
  });

  it('fails when the workspace is archived', async () => {
    const { service, workspaceService } = await createService();
    const id = await createActiveWorkspace(workspaceService);
    await service.addMember(id, ALICE, 'member', context);
    await workspaceService.archive(id, 'done', context);
    const result = await service.removeMember(id, ALICE, context);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBeInstanceOf(WorkspaceArchivedError);
  });
});

describe('WorkspaceMembershipService.changeRole', () => {
  it('changes a member role', async () => {
    const { service, workspaceService } = await createService();
    const id = await createActiveWorkspace(workspaceService);
    await service.addMember(id, ALICE, 'member', context);
    const result = await service.changeRole(id, ALICE, 'admin', context);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.membership.role).toBe('admin');
  });

  it('rejects demoting the last owner', async () => {
    const { service, workspaceService } = await createService();
    const id = await createActiveWorkspace(workspaceService);
    await service.addMember(id, ALICE, 'owner', context);
    const result = await service.changeRole(id, ALICE, 'member', context);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBeInstanceOf(LastOwnerRemovalError);
  });

  it('allows demoting an owner when another owner remains', async () => {
    const { service, workspaceService } = await createService();
    const id = await createActiveWorkspace(workspaceService);
    await service.addMember(id, ALICE, 'owner', context);
    await service.addMember(id, BOB, 'owner', context);
    const result = await service.changeRole(id, ALICE, 'member', context);
    expect(result.ok).toBe(true);
  });

  it('fails when the membership does not exist', async () => {
    const { service, workspaceService } = await createService();
    const id = await createActiveWorkspace(workspaceService);
    const result = await service.changeRole(id, ALICE, 'admin', context);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBeInstanceOf(MemberNotFoundError);
  });

  it('rejects an invalid target role', async () => {
    const { service, workspaceService } = await createService();
    const id = await createActiveWorkspace(workspaceService);
    await service.addMember(id, ALICE, 'member', context);
    const result = await service.changeRole(id, ALICE, 'boss' as never, context);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBeInstanceOf(InvalidWorkspaceValueError);
  });

  it('is a no-op for the same role', async () => {
    const { service, workspaceService } = await createService();
    const id = await createActiveWorkspace(workspaceService);
    await service.addMember(id, ALICE, 'admin', context);
    const result = await service.changeRole(id, ALICE, 'admin', context);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.membership.role).toBe('admin');
    expect(result.value.events).toHaveLength(0);
  });
});

describe('WorkspaceMembershipService.listByWorkspace', () => {
  it('lists the memberships of a workspace', async () => {
    const { service, workspaceService } = await createService();
    const id = await createActiveWorkspace(workspaceService);
    await service.addMember(id, ALICE, 'member', context);
    await service.addMember(id, BOB, 'admin', context);
    const result = await service.listByWorkspace(id);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toHaveLength(2);
  });

  it('fails for a missing workspace', async () => {
    const { service } = await createService();
    const result = await service.listByWorkspace(WorkspaceId.create());
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBeInstanceOf(WorkspaceNotFoundError);
  });
});
