/**
 * Aggregate reconstitution tests: `snapshot()` → `hydrate()` round-trips must
 * restore exact identity, timestamps, version, and child state WITHOUT
 * emitting domain events (PERSISTENCE.md §4 reconstitution).
 */

import { describe, expect, it } from 'vitest';
import type { TenantId, UserId } from '@nexora/contracts/common';
import { prefixedId } from '@nexora/shared/ids';

import { User } from '../src/entities/user.js';
import { Session } from '../src/entities/session.js';
import { Role } from '../src/entities/role.js';
import { PasswordHash } from '../src/value-objects/password-hash.js';
import { UserStatus } from '../src/value-objects/user-status.js';
import { Email } from '../src/value-objects/email.js';
import { Username } from '../src/value-objects/username.js';
import { DisplayName } from '../src/value-objects/display-name.js';
import { testContext } from './helpers.js';

const TENANT = 'tenant_1' as TenantId;
const context = testContext();

describe('User hydrate round-trip', () => {
  it('restores identity, timestamps, version, and roles without events', () => {
    const user = User.create(
      {
        tenantId: TENANT,
        email: Email.create('alice@example.com'),
        username: Username.create('alice'),
        passwordHash: PasswordHash.create('argon2id', 'hash-value'),
        displayName: DisplayName.create('Alice'),
        title: 'Engineer',
        bio: 'Builds things',
        status: UserStatus.active(),
      },
      context,
    );
    user.pullDomainEvents();
    user.assignRole('owner', context);
    user.pullDomainEvents();
    user.updateProfile({ displayName: 'Alice A.', title: 'Staff' });
    const before = user.version;

    const hydrated = User.hydrate(User.snapshot(user));
    expect(hydrated.id).toBe(user.id);
    expect(hydrated.tenantId).toBe(TENANT);
    expect(hydrated.email.value).toBe('alice@example.com');
    expect(hydrated.username.value).toBe('alice');
    expect(hydrated.status.value).toBe('active');
    expect(hydrated.roles).toEqual(['owner']);
    expect(hydrated.profile.displayName.value).toBe('Alice A.');
    expect(hydrated.profile.title).toBe('Staff');
    expect(hydrated.createdAt).toBe(user.createdAt);
    expect(hydrated.updatedAt).toBe(user.updatedAt);
    expect(hydrated.version).toBe(before);
    expect(hydrated.pullDomainEvents()).toHaveLength(0);
  });

  it('hydrated users can be mutated and activate transitions still enforce policy', () => {
    const user = User.create(
      {
        tenantId: TENANT,
        email: Email.create('bob@example.com'),
        username: Username.create('bob'),
        passwordHash: PasswordHash.create('argon2id', 'h'),
        displayName: DisplayName.create('Bob'),
        status: UserStatus.pending(),
      },
      context,
    );
    const hydrated = User.hydrate(User.snapshot(user));
    hydrated.activate(context);
    expect(hydrated.status.value).toBe('active');
    expect(hydrated.version).toBe(user.version + 1);
    expect(hydrated.pullDomainEvents().map((event) => event.type)).toContain(
      'identity.user.activated',
    );
  });
});

describe('Session hydrate round-trip', () => {
  it('restores every field including ended sessions', () => {
    const userId = prefixedId('usr') as UserId;
    const session = Session.start(
      {
        userId,
        tenantId: TENANT,
        token: 'tok-123',
        expiresAt: '2099-01-01T00:00:00.000Z',
      },
      context,
    );
    session.end(context, 'logout');
    const before = session.version;

    const hydrated = Session.hydrate(Session.snapshot(session));
    expect(hydrated.id).toBe(session.id);
    expect(hydrated.userId).toBe(userId);
    expect(hydrated.token).toBe('tok-123');
    expect(hydrated.status.value).toBe('ended');
    expect(hydrated.issuedAt).toBe(session.issuedAt);
    expect(hydrated.expiresAt).toBe(session.expiresAt);
    expect(hydrated.lastUsedAt).toBe(session.lastUsedAt);
    expect(hydrated.endedAt).toBe(session.endedAt);
    expect(hydrated.version).toBe(before);
    expect(hydrated.pullDomainEvents()).toHaveLength(0);
  });

  it('an active hydrated session validates against expiry', () => {
    const session = Session.start(
      {
        userId: prefixedId('usr') as UserId,
        tenantId: TENANT,
        token: 'tok-live',
        expiresAt: '2099-01-01T00:00:00.000Z',
      },
      context,
    );
    const hydrated = Session.hydrate(Session.snapshot(session));
    expect(hydrated.isActive('2026-01-01T00:00:00.000Z')).toBe(true);
  });
});

describe('Role hydrate round-trip', () => {
  it('restores permissions, approver, and version', () => {
    const role = Role.create({
      name: 'workspace.admin',
      level: 'workspace',
      approver: true,
      description: 'Admin role',
      permissions: [
        { name: 'workspace.update', scopes: ['workspace:write'] },
        { name: 'member.manage', scopes: ['member:write'] },
      ],
    });
    const before = role.version;

    const hydrated = Role.hydrate(Role.snapshot(role));
    expect(hydrated.id).toBe(role.id);
    expect(hydrated.name).toBe('workspace.admin');
    expect(hydrated.level).toBe('workspace');
    expect(hydrated.approver).toBe(true);
    expect(hydrated.description).toBe('Admin role');
    expect(hydrated.permissions.map((p) => p.name)).toEqual(['workspace.update', 'member.manage']);
    expect(hydrated.scopesFor('workspace.update')).toEqual(['workspace:write']);
    expect(hydrated.version).toBe(before);
  });
});
