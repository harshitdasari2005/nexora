/**
 * Domain policy tests: user lifecycle, session policy, permission
 * invariants, and role invariants.
 */

import { describe, expect, it } from 'vitest';

import {
  SessionLimitExceededError,
  InvalidIdentityValueError,
  UserNotActiveError,
  UserStateTransitionError,
} from '../src/errors/index.js';
import {
  DEFAULT_IDLE_TIMEOUT_MS,
  DEFAULT_MAX_CONCURRENT_SESSIONS,
  DEFAULT_SESSION_TTL_MS,
  MIN_PASSWORD_LENGTH,
  PermissionInvariants,
  RoleInvariants,
  SessionPolicy,
  USER_TRANSITIONS,
  UserLifecyclePolicy,
} from '../src/policies/index.js';
import { SessionStatus } from '../src/value-objects/session-status.js';
import { UserStatus } from '../src/value-objects/user-status.js';

describe('UserLifecyclePolicy', () => {
  const policy = new UserLifecyclePolicy();

  it('defines a complete transition table', () => {
    expect(USER_TRANSITIONS.pending).toEqual(['active']);
    expect(USER_TRANSITIONS.active).toEqual(['suspended', 'deactivated']);
    expect(USER_TRANSITIONS.suspended).toEqual(['active', 'deactivated']);
    expect(USER_TRANSITIONS.deactivated).toEqual([]);
  });

  it('accepts a strong password', () => {
    expect(policy.validatePassword('CorrectHorse1')).toEqual([]);
  });

  it('rejects a short password', () => {
    const issues = policy.validatePassword('Ab1');
    expect(issues.some((issue) => issue.path === 'password')).toBe(true);
  });

  it('rejects a password without a digit', () => {
    const issues = policy.validatePassword('abcdefgh');
    expect(issues.length).toBeGreaterThan(0);
  });

  it('rejects a password without a letter', () => {
    const issues = policy.validatePassword('12345678');
    expect(issues.length).toBeGreaterThan(0);
  });

  it('reports the minimum length in the issue message', () => {
    const issues = policy.validatePassword('short');
    expect(issues[0]?.message).toContain(String(MIN_PASSWORD_LENGTH));
  });

  it('allows pending → active', () => {
    expect(() =>
      policy.assertCanTransition(UserStatus.pending(), UserStatus.active()),
    ).not.toThrow();
  });

  it('rejects active → pending', () => {
    expect(() => policy.assertCanTransition(UserStatus.active(), UserStatus.pending())).toThrow(
      UserStateTransitionError,
    );
  });

  it('rejects deactivated → active', () => {
    expect(() => policy.assertCanTransition(UserStatus.deactivated(), UserStatus.active())).toThrow(
      UserStateTransitionError,
    );
  });

  it('allows active → suspended and suspended → active', () => {
    expect(() =>
      policy.assertCanTransition(UserStatus.active(), UserStatus.suspended()),
    ).not.toThrow();
    expect(() =>
      policy.assertCanTransition(UserStatus.suspended(), UserStatus.active()),
    ).not.toThrow();
  });

  it('rejects a session for a non-active user (non-throwing boundary)', () => {
    expect(policy.assertCanStartSession(UserStatus.deactivated())).toBe(false);
    expect(policy.assertCanStartSession(UserStatus.pending())).toBe(false);
    expect(policy.assertCanStartSession(UserStatus.suspended())).toBe(false);
    // Admin/audit flows use the throwing variant when the status must leak.
    expect(() => policy.assertUserCanStartSession(UserStatus.deactivated())).toThrow(
      UserNotActiveError,
    );
  });

  it('allows a session for an active user', () => {
    expect(policy.assertCanStartSession(UserStatus.active())).toBe(true);
    expect(() => policy.assertUserCanStartSession(UserStatus.active())).not.toThrow();
  });
});

describe('SessionPolicy', () => {
  it('applies platform defaults', () => {
    const policy = new SessionPolicy();
    expect(policy.ttlMs).toBe(DEFAULT_SESSION_TTL_MS);
    expect(policy.idleTimeoutMs).toBe(DEFAULT_IDLE_TIMEOUT_MS);
    expect(policy.maxConcurrentSessions).toBe(DEFAULT_MAX_CONCURRENT_SESSIONS);
  });

  it('computes the expiry from the TTL', () => {
    const policy = new SessionPolicy({ ttlMs: 3_600_000 });
    expect(policy.expiresAt('2026-01-01T00:00:00.000Z')).toBe('2026-01-01T01:00:00.000Z');
  });

  it('detects an idle-expired session', () => {
    const policy = new SessionPolicy({ idleTimeoutMs: 3_600_000 });
    expect(policy.isIdleExpired('2026-01-01T00:00:00.000Z', '2026-01-01T02:00:00.000Z')).toBe(true);
    expect(policy.isIdleExpired('2026-01-01T00:00:00.000Z', '2026-01-01T00:30:00.000Z')).toBe(
      false,
    );
  });

  it('allows a new session under the limit', () => {
    const policy = new SessionPolicy({ maxConcurrentSessions: 5 });
    expect(() => policy.assertCanOpenSession(4)).not.toThrow();
  });

  it('rejects a new session at the limit', () => {
    const policy = new SessionPolicy({ maxConcurrentSessions: 5 });
    expect(() => policy.assertCanOpenSession(5)).toThrow(SessionLimitExceededError);
  });
});

describe('PermissionInvariants', () => {
  const invariants = new PermissionInvariants();

  it('accepts a valid permission name', () => {
    expect(invariants.validateName('projects.create')).toBeNull();
  });

  it('rejects an invalid permission name', () => {
    expect(invariants.validateName('Projects.Create')).not.toBeNull();
    expect(invariants.validateName('')).not.toBeNull();
  });

  it('accepts valid scopes', () => {
    expect(invariants.validateScopes(['projects:write', 'projects:read'])).toHaveLength(0);
  });

  it('rejects empty scopes', () => {
    expect(invariants.validateScopes([]).length).toBeGreaterThan(0);
  });

  it('rejects an invalid scope', () => {
    expect(invariants.validateScopes(['PROJECTS:WRITE']).length).toBeGreaterThan(0);
    expect(invariants.validateScopes(['nowrite']).length).toBeGreaterThan(0);
  });

  it('assertValidPermission throws on invalid input', () => {
    expect(() => invariants.assertValidPermission('bad name', ['projects:write'])).toThrow(
      InvalidIdentityValueError,
    );
    expect(() => invariants.assertValidPermission('projects.read', [])).toThrow(
      InvalidIdentityValueError,
    );
  });

  it('assertValidPermission passes on valid input', () => {
    expect(() =>
      invariants.assertValidPermission('projects.read', ['projects:read']),
    ).not.toThrow();
  });
});

describe('RoleInvariants', () => {
  const invariants = new RoleInvariants();

  it('accepts a valid role name and level', () => {
    expect(() => invariants.assertValidRole('workspace.admin', 'workspace')).not.toThrow();
    expect(() => invariants.assertValidRole('global.superadmin', 'global')).not.toThrow();
    expect(() => invariants.assertValidRole('hr.approver', 'application')).not.toThrow();
  });

  it('rejects an invalid role name', () => {
    expect(() => invariants.assertValidRole('Admin', 'workspace')).toThrow(
      InvalidIdentityValueError,
    );
  });

  it('rejects an invalid level', () => {
    expect(() => invariants.assertValidRole('workspace.admin', 'invalid' as never)).toThrow(
      InvalidIdentityValueError,
    );
  });
});

describe('SessionStatus helpers', () => {
  it('distinguishes terminal states', () => {
    expect(SessionStatus.ended().isActive()).toBe(false);
    expect(SessionStatus.expired().isActive()).toBe(false);
    expect(SessionStatus.revoked().isActive()).toBe(false);
  });
});
