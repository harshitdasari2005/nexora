/**
 * WorkspaceMembership aggregate tests: creation, role validity, role changes,
 * last-owner signaling, event emission, and versioning.
 */

import { describe, expect, it } from 'vitest';
import type { UserId } from '@nexora/contracts/common';

import { InvalidWorkspaceValueError } from '../src/errors/index.js';
import { WORKSPACE_EVENT_TYPES, type MemberAddedPayload } from '../src/events/index.js';
import { WorkspaceMembership } from '../src/entities/workspace-membership.js';
import { WorkspaceId } from '../src/value-objects/workspace-id.js';
import { testContext } from './helpers.js';

const context = testContext();
const WORKSPACE = WorkspaceId.create();
const USER = 'usr_alice' as UserId;

function createMembership(
  overrides: Partial<Parameters<typeof WorkspaceMembership.create>[0]> = {},
): WorkspaceMembership {
  return WorkspaceMembership.create(
    {
      workspaceId: WORKSPACE,
      userId: USER,
      role: 'member',
      ...overrides,
    },
    context,
  );
}

describe('WorkspaceMembership aggregate', () => {
  it('creates with the given role and emits MemberAdded', () => {
    const membership = createMembership({ role: 'admin' });
    expect(membership.id).toMatch(/^mbr_/);
    expect(membership.workspaceId).toBe(WORKSPACE);
    expect(membership.userId).toBe(USER);
    expect(membership.role).toBe('admin');
    expect(membership.version).toBe(1);
    expect(membership.joinedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    const events = membership.pullDomainEvents();
    expect(events).toHaveLength(1);
    expect(events[0]?.type).toBe(WORKSPACE_EVENT_TYPES.memberAdded);
    if (events[0]) {
      const payload = events[0].payload as MemberAddedPayload;
      expect(payload.workspaceId).toBe(WORKSPACE);
      expect(payload.userId).toBe(USER);
      expect(payload.role).toBe('admin');
      expect(payload.membershipId).toBe(membership.id);
    }
  });

  it('rejects an invalid role at creation', () => {
    expect(() => createMembership({ role: 'superadmin' as never })).toThrow(
      InvalidWorkspaceValueError,
    );
  });

  it('reports owner status', () => {
    expect(createMembership({ role: 'owner' }).isOwner()).toBe(true);
    expect(createMembership({ role: 'admin' }).isOwner()).toBe(false);
    expect(createMembership({ role: 'member' }).isOwner()).toBe(false);
  });

  it('changes role and bumps the version', () => {
    const membership = createMembership({ role: 'member' });
    expect(membership.changeRole('admin')).toBe(true);
    expect(membership.role).toBe('admin');
    expect(membership.version).toBe(2);
  });

  it('changeRole to the same role is a no-op', () => {
    const membership = createMembership({ role: 'member' });
    membership.pullDomainEvents();
    expect(membership.changeRole('member')).toBe(false);
    expect(membership.version).toBe(1);
    expect(membership.pullDomainEvents()).toHaveLength(0);
  });

  it('rejects an invalid role change', () => {
    const membership = createMembership();
    expect(() => membership.changeRole('boss' as never)).toThrow(InvalidWorkspaceValueError);
    expect(membership.role).toBe('member');
  });

  it('role changes do not emit domain events in v1', () => {
    const membership = createMembership();
    membership.pullDomainEvents();
    membership.changeRole('admin');
    expect(membership.pullDomainEvents()).toHaveLength(0);
  });

  it('honors an explicit join time', () => {
    const membership = WorkspaceMembership.create(
      { workspaceId: WORKSPACE, userId: USER, role: 'member' },
      context,
      '2026-01-01T00:00:00.000Z',
    );
    expect(membership.joinedAt).toBe('2026-01-01T00:00:00.000Z');
  });

  it('pullDomainEvents clears the queue', () => {
    const membership = createMembership();
    expect(membership.pullDomainEvents().length).toBeGreaterThan(0);
    expect(membership.pullDomainEvents()).toHaveLength(0);
  });
});
