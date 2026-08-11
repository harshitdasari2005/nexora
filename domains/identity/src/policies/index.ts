/**
 * @nexora/domain-identity — domain policies.
 *
 * The Identity & Access business rules, extracted so the platform can reuse
 * them and so aggregate invariants stay in one authoritative place
 * (DOMAIN_MODEL.md §9, §13; PSD.md §10, §12). Policies are pure: they have
 * no I/O and throw typed domain errors on violation.
 */

import type { Role, RoleLevel, Scope } from '@nexora/contracts/identity';

import {
  InvalidIdentityValueError,
  SessionLimitExceededError,
  UserNotActiveError,
  UserStateTransitionError,
} from '../errors/index.js';
import type { UserStatus } from '../value-objects/user-status.js';
import { type UserStatusValue } from '../value-objects/user-status.js';

/** Minimum password length required by the platform policy. */
export const MIN_PASSWORD_LENGTH = 8;

/** Default session time-to-live in milliseconds (8 hours). */
export const DEFAULT_SESSION_TTL_MS = 8 * 60 * 60 * 1_000;

/** Default idle timeout in milliseconds (30 minutes). */
export const DEFAULT_IDLE_TIMEOUT_MS = 30 * 60 * 1_000;

/** Default maximum concurrent sessions per user. */
export const DEFAULT_MAX_CONCURRENT_SESSIONS = 10;

/** A validation issue produced by a policy check. */
export interface PolicyIssue {
  /** Dot-separated field path. */
  path: string;
  /** Human-readable message. */
  message: string;
}

/**
 * The user lifecycle transition table (PSD.md §10 user model). The single
 * authoritative definition — the User aggregate and all policies consult it.
 */
export const USER_TRANSITIONS: Readonly<Record<UserStatusValue, readonly UserStatusValue[]>> = {
  pending: ['active'],
  active: ['suspended', 'deactivated'],
  suspended: ['active', 'deactivated'],
  deactivated: [],
};

/**
 * User lifecycle rules: password strength, allowed status transitions, and
 * session-start eligibility (PSD.md §10, BR-* rules).
 */
export class UserLifecyclePolicy {
  /**
   * Validates a raw password against the platform strength policy.
   * Returns issues; an empty array means the password is acceptable.
   */
  validatePassword(password: string): readonly PolicyIssue[] {
    const issues: PolicyIssue[] = [];
    if (password.length < MIN_PASSWORD_LENGTH) {
      issues.push({
        path: 'password',
        message: `Must be at least ${MIN_PASSWORD_LENGTH} characters`,
      });
    }
    if (!/[A-Za-z]/.test(password)) {
      issues.push({ path: 'password', message: 'Must contain at least one letter' });
    }
    if (!/\d/.test(password)) {
      issues.push({ path: 'password', message: 'Must contain at least one digit' });
    }
    return issues;
  }

  /** The statuses reachable from the given status. */
  allowedTargets(current: UserStatus): readonly UserStatusValue[] {
    return USER_TRANSITIONS[current.value];
  }

  /**
   * Asserts the user may transition to the target status.
   *
   * @throws {UserStateTransitionError} when the transition is not allowed.
   */
  assertCanTransition(current: UserStatus, target: UserStatus): void {
    const allowed = this.allowedTargets(current);
    if (!allowed.includes(target.value)) {
      throw new UserStateTransitionError(
        `Cannot transition a user from ${current.value} to ${target.value}`,
        { from: current.value, to: target.value },
      );
    }
  }

  /**
   * Whether a user may start a session (must be `active`). Returns a boolean
   * so login boundaries can treat failure as invalid credentials without
   * leaking account status (no user enumeration).
   */
  assertCanStartSession(status: UserStatus): boolean {
    return status.isActive();
  }

  /**
   * Asserts a user may start a session (must be `active`).
   *
   * @throws {UserNotActiveError} when the user cannot authenticate.
   */
  assertUserCanStartSession(status: UserStatus): void {
    if (!status.isActive()) {
      throw new UserNotActiveError({ status: status.value });
    }
  }
}

/** Configuration for the {@link SessionPolicy}. */
export interface SessionPolicyConfig {
  /** Session time-to-live in milliseconds. */
  ttlMs?: number;
  /** Idle timeout in milliseconds. */
  idleTimeoutMs?: number;
  /** Maximum concurrent sessions per user. */
  maxConcurrentSessions?: number;
}

/**
 * Session rules: TTL, idle timeout, and concurrent-session limits
 * (PSD.md §10 sessions; SAD.md §13.1).
 */
export class SessionPolicy {
  readonly ttlMs: number;
  readonly idleTimeoutMs: number;
  readonly maxConcurrentSessions: number;

  constructor(config: SessionPolicyConfig = {}) {
    this.ttlMs = config.ttlMs ?? DEFAULT_SESSION_TTL_MS;
    this.idleTimeoutMs = config.idleTimeoutMs ?? DEFAULT_IDLE_TIMEOUT_MS;
    this.maxConcurrentSessions = config.maxConcurrentSessions ?? DEFAULT_MAX_CONCURRENT_SESSIONS;
  }

  /** Computes the expiry instant for a session issued at `issuedAt`. */
  expiresAt(issuedAt: string): string {
    return new Date(Date.parse(issuedAt) + this.ttlMs).toISOString();
  }

  /** Whether a session is idle past the idle timeout. */
  isIdleExpired(lastUsedAt: string, now: string): boolean {
    return Date.parse(now) - Date.parse(lastUsedAt) > this.idleTimeoutMs;
  }

  /**
   * Asserts the user may open a new session given their active count.
   *
   * @throws {SessionLimitExceededError} when the limit is reached.
   */
  assertCanOpenSession(activeSessions: number): void {
    if (activeSessions >= this.maxConcurrentSessions) {
      throw new SessionLimitExceededError({
        activeSessions,
        max: this.maxConcurrentSessions,
      });
    }
  }
}

/** Permission name pattern: lowercase segments separated by dots. */
const PERMISSION_NAME_PATTERN = /^[a-z][a-z0-9]*(?:\.[a-z0-9_]+)*$/;

/** Scope pattern: resource:action, e.g. `projects:write`. */
const SCOPE_PATTERN = /^[a-z][a-z0-9]*(?::[a-z0-9_]+)+$/;

/**
 * Permission invariants: valid names, valid scopes, at least one scope, and
 * uniqueness within a role (PSD.md §10.4, PRM-*).
 */
export class PermissionInvariants {
  /** Validates a permission name. Returns an issue or `null`. */
  validateName(name: string): PolicyIssue | null {
    if (!PERMISSION_NAME_PATTERN.test(name)) {
      return {
        path: 'name',
        message: 'Permission name must be lowercase segments separated by dots',
      };
    }
    return null;
  }

  /**
   * Validates a scope list: non-empty, each scope well-formed. Returns
   * issues; an empty array means the scopes are acceptable.
   */
  validateScopes(scopes: readonly Scope[]): readonly PolicyIssue[] {
    const issues: PolicyIssue[] = [];
    if (scopes.length === 0) {
      issues.push({ path: 'scopes', message: 'At least one scope is required' });
    }
    for (const scope of scopes) {
      if (!SCOPE_PATTERN.test(scope)) {
        issues.push({
          path: 'scopes',
          message: `Scope ${JSON.stringify(scope)} must be resource:action`,
        });
      }
    }
    return issues;
  }

  /**
   * Asserts a permission declaration is valid.
   *
   * @throws {InvalidIdentityValueError} when the permission is invalid.
   */
  assertValidPermission(name: string, scopes: readonly Scope[]): void {
    const issues: PolicyIssue[] = [];
    const nameIssue = this.validateName(name);
    if (nameIssue !== null) {
      issues.push(nameIssue);
    }
    issues.push(...this.validateScopes(scopes));
    if (issues.length > 0) {
      throw new InvalidIdentityValueError('Invalid permission', issues);
    }
  }
}

/** Role name pattern: lowercase segments separated by dots. */
const ROLE_NAME_PATTERN = /^[a-z][a-z0-9]*(?:\.[a-z0-9_]+)*$/;

/** Valid role levels (PSD.md §10.1-10.3). */
const VALID_ROLE_LEVELS: readonly RoleLevel[] = ['global', 'workspace', 'application'];

/**
 * Role invariants: valid names and levels (PSD.md §10 roles).
 */
export class RoleInvariants {
  /**
   * Asserts a role name and level are valid.
   *
   * @throws {InvalidIdentityValueError} when the name or level is invalid.
   */
  assertValidRole(name: Role, level: RoleLevel): void {
    const issues: PolicyIssue[] = [];
    if (!ROLE_NAME_PATTERN.test(name)) {
      issues.push({
        path: 'name',
        message: 'Role name must be lowercase segments separated by dots',
      });
    }
    if (!VALID_ROLE_LEVELS.includes(level)) {
      issues.push({
        path: 'level',
        message: `Level must be one of: ${VALID_ROLE_LEVELS.join(', ')}`,
      });
    }
    if (issues.length > 0) {
      throw new InvalidIdentityValueError('Invalid role', issues);
    }
  }
}
