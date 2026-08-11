/**
 * User aggregate tests: lifecycle transitions, role management, invariants,
 * and event emission.
 */

import { describe, expect, it } from 'vitest';
import type { TenantId } from '@nexora/contracts/common';

import { IDENTITY_EVENT_TYPES } from '../src/events/index.js';
import {
  RoleAlreadyAssignedError,
  RoleNotAssignedError,
  UserStateTransitionError,
} from '../src/errors/index.js';
import { User } from '../src/entities/user.js';
import { DisplayName } from '../src/value-objects/display-name.js';
import { Email } from '../src/value-objects/email.js';
import { PasswordHash } from '../src/value-objects/password-hash.js';
import { Username } from '../src/value-objects/username.js';
import { UserStatus } from '../src/value-objects/user-status.js';
import { testContext } from './helpers.js';

const TENANT = 'tenant_1' as TenantId;
const context = testContext();

function createUser(overrides: { status?: UserStatus } = {}): User {
  return User.create(
    {
      tenantId: TENANT,
      email: Email.create('alice@example.com'),
      username: Username.create('alice'),
      passwordHash: PasswordHash.create('scrypt', 'hash-value'),
      displayName: DisplayName.create('Alice'),
      status: overrides.status,
    },
    context,
  );
}

describe('User aggregate', () => {
  it('creates with pending status by default and emits UserCreated', () => {
    const user = createUser();
    expect(user.status.value).toBe('pending');
    expect(user.isActive()).toBe(false);
    const events = user.pullDomainEvents();
    expect(events).toHaveLength(1);
    expect(events[0]?.type).toBe(IDENTITY_EVENT_TYPES.userCreated);
  });

  it('honors an explicit initial status', () => {
    const user = createUser({ status: UserStatus.active() });
    expect(user.isActive()).toBe(true);
  });

  it('activates a pending user and emits UserActivated', () => {
    const user = createUser();
    user.activate(context);
    expect(user.isActive()).toBe(true);
    expect(user.status.value).toBe('active');
    const events = user.pullDomainEvents();
    expect(events.map((event) => event.type)).toContain(IDENTITY_EVENT_TYPES.userActivated);
  });

  it('rejects activating an already-active user', () => {
    const user = createUser({ status: UserStatus.active() });
    expect(() => user.activate(context)).toThrow(UserStateTransitionError);
  });

  it('rejects activating a deactivated user', () => {
    const user = createUser();
    user.activate(context);
    user.deactivate('offboarding', context);
    expect(() => user.activate(context)).toThrow(UserStateTransitionError);
  });

  it('deactivates an active user and emits UserDeactivated', () => {
    const user = createUser({ status: UserStatus.active() });
    user.deactivate('offboarding', context);
    expect(user.status.value).toBe('deactivated');
    expect(user.isActive()).toBe(false);
    const events = user.pullDomainEvents();
    expect(events.map((event) => event.type)).toContain(IDENTITY_EVENT_TYPES.userDeactivated);
    expect(events[0]).toBeDefined();
  });

  it('rejects deactivating an already-deactivated user', () => {
    const user = createUser({ status: UserStatus.active() });
    user.deactivate('first', context);
    expect(() => user.deactivate('again', context)).toThrow(UserStateTransitionError);
  });

  it('rejects deactivating a pending user', () => {
    const user = createUser();
    expect(() => user.deactivate('premature', context)).toThrow(UserStateTransitionError);
  });

  it('suspends an active user and emits UserSuspended', () => {
    const user = createUser({ status: UserStatus.active() });
    user.suspend('policy-hold', context);
    expect(user.status.value).toBe('suspended');
    expect(user.isActive()).toBe(false);
    const events = user.pullDomainEvents();
    expect(events.map((event) => event.type)).toContain(IDENTITY_EVENT_TYPES.userSuspended);
  });

  it('rejects suspending a pending user', () => {
    const user = createUser();
    expect(() => user.suspend('hold', context)).toThrow(UserStateTransitionError);
  });

  it('rejects suspending a deactivated user', () => {
    const user = createUser({ status: UserStatus.active() });
    user.deactivate('offboarding', context);
    expect(() => user.suspend('hold', context)).toThrow(UserStateTransitionError);
  });

  it('activates a suspended user (suspended → active is allowed)', () => {
    const user = createUser({ status: UserStatus.suspended() });
    user.activate(context);
    expect(user.status.value).toBe('active');
    expect(user.isActive()).toBe(true);
  });

  it('assigns a role and emits RoleAssigned', () => {
    const user = createUser();
    user.assignRole('workspace.admin', context);
    expect(user.hasRole('workspace.admin')).toBe(true);
    expect(user.roles).toContain('workspace.admin');
    const events = user.pullDomainEvents();
    expect(events.map((event) => event.type)).toContain(IDENTITY_EVENT_TYPES.roleAssigned);
  });

  it('rejects assigning the same role twice', () => {
    const user = createUser();
    user.assignRole('workspace.admin', context);
    expect(() => user.assignRole('workspace.admin', context)).toThrow(RoleAlreadyAssignedError);
  });

  it('removes a role and emits RoleRemoved', () => {
    const user = createUser();
    user.assignRole('workspace.admin', context);
    user.removeRole('workspace.admin', context);
    expect(user.hasRole('workspace.admin')).toBe(false);
    const events = user.pullDomainEvents();
    expect(events.map((event) => event.type)).toContain(IDENTITY_EVENT_TYPES.roleRemoved);
  });

  it('rejects removing a role that is not assigned', () => {
    const user = createUser();
    expect(() => user.removeRole('finance.reviewer', context)).toThrow(RoleNotAssignedError);
  });

  it('updates the profile', () => {
    const user = createUser();
    user.updateProfile({ displayName: 'Alice B.' });
    expect(user.profile.displayName.value).toBe('Alice B.');
  });

  it('changes the password hash', () => {
    const user = createUser();
    const next = PasswordHash.create('argon2id', 'new-hash');
    user.changePassword(next);
    expect(user.passwordHash.equals(next)).toBe(true);
  });

  it('bumps the version on every mutation', () => {
    const user = createUser();
    const v1 = user.version;
    user.assignRole('workspace.admin', context);
    expect(user.version).toBeGreaterThan(v1);
  });

  it('pullDomainEvents clears the queue', () => {
    const user = createUser();
    user.pullDomainEvents();
    expect(user.pullDomainEvents()).toHaveLength(0);
  });

  it('assigning multiple roles keeps all of them', () => {
    const user = createUser();
    user.assignRole('workspace.admin', context);
    user.assignRole('hr.approver', context);
    expect([...user.roles].sort()).toEqual(['hr.approver', 'workspace.admin']);
  });
});
