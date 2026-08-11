/**
 * @nexora/contracts — identity contracts.
 *
 * Identity, session, token, role, scope, and permission contracts
 * (API_CONTRACTS.md §7-8, SAD.md §13.1-2, PSD.md §10 user model). The
 * Identity platform produces these; the Policy Engine consumes the principal
 * for authorization decisions (API_CONTRACTS.md §8).
 */

import type { TenantId, Timestamp, UserId, WorkspaceId } from '../common/index.js';

/**
 * A permission scope string, e.g. `projects:write`. Scopes are the units the
 * Policy Engine evaluates (API_CONTRACTS.md §8).
 */
export type Scope = string;

/**
 * A role name, e.g. `workspace.admin`, `hr.approver`. Roles are assigned at
 * global, workspace, and application levels (PSD.md §10 permission model).
 */
export type Role = string;

/** The scope level a role applies at (PSD.md §10 hierarchical permissions). */
export type RoleLevel = 'global' | 'workspace' | 'application';

/**
 * A role definition: the permissions a role grants and the level at which
 * it applies (PSD.md §10.1-10.3). Roles are configuration, not code; they
 * are resolved by the Policy Engine at evaluation time.
 */
export interface RoleDefinition {
  /** The role name, e.g. `workspace.admin`. */
  name: Role;
  /** The scope level the role applies at. */
  level: RoleLevel;
  /** Permission names granted by the role. */
  permissions: readonly string[];
  /** Whether the role may approve consequential actions (AIR.md §12). */
  approver: boolean;
  /** Optional description of the role's purpose. */
  description?: string;
}

/**
 * A named permission: a role grants permissions, each of which references
 * one or more scopes.
 */
export interface Permission {
  /** Permission name, e.g. `projects.create`. */
  name: string;
  /** Scopes granted by this permission. */
  scopes: readonly Scope[];
}

/**
 * The authenticated principal at the boundary. Carries the resolved identity
 * and scope context so downstream modules never re-derive authorization.
 */
export interface Principal {
  /** The user id. */
  userId: UserId;
  /** Tenant (company) the session is scoped to. */
  tenantId: TenantId;
  /** Workspace the session is scoped to, when workspace-scoped. */
  workspaceId?: WorkspaceId;
  /** Global roles assigned to the principal (PSD.md §10). */
  roles: readonly Role[];
  /** Whether the session is elevated (MFA confirmed). */
  mfaVerified: boolean;
  /** ISO-8601 UTC time the session was issued. */
  issuedAt: Timestamp;
}

/**
 * An OIDC/JWT identity token payload (for SSO integrations, API_CONTRACTS.md
 * §7 SSO). Fields follow standard OIDC claims.
 */
export interface IdentityClaims {
  /** Subject — the external user id at the IdP. */
  sub: string;
  /** Email of the user. */
  email: string;
  /** Email verified flag from the IdP. */
  emailVerified: boolean;
  /** Display name, when provided. */
  name?: string;
  /** Issuer of the token. */
  iss?: string;
  /** Audience(s) of the token. */
  aud?: readonly string[];
}

/**
 * A session token (opaque bearer) issued by the Identity platform.
 */
export interface SessionToken {
  /** Opaque token value; never logged (SAD.md §13.6). */
  token: string;
  /** Token type, always `bearer`. */
  tokenType: 'bearer';
  /** ISO-8601 UTC expiry time. */
  expiresAt: Timestamp;
}

/**
 * A session record for session management endpoints.
 */
export interface SessionInfo {
  /** Session id. */
  id: string;
  /** The user the session belongs to. */
  userId: UserId;
  /** ISO-8601 UTC time the session was created. */
  createdAt: Timestamp;
  /** ISO-8601 UTC expiry time. */
  expiresAt: Timestamp;
  /** Whether the session is currently active. */
  active: boolean;
}

/** MFA method kinds supported by the Identity platform (API_CONTRACTS.md §7). */
export type MfaMethod = 'totp' | 'webauthn' | 'sms';

/**
 * A resolved permission decision from the Policy Engine (deny-wins, AIR.md
 * §13).
 */
export interface PermissionDecision {
  /** Whether the action is permitted. */
  allowed: boolean;
  /** Scopes that justified the decision, when allowed. */
  grantedBy?: readonly Scope[];
  /** Policy id that denied the action, when denied. */
  deniedByPolicy?: string;
  /** Whether the action requires human approval. */
  requiresApproval: boolean;
}
