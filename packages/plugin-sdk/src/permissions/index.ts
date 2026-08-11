/**
 * @nexora/plugin-sdk — permissions.
 *
 * Permission contributions: the declarative permission surface a plugin adds
 * to the platform (PSD.md §10 permission model). The canonical identity
 * vocabulary (`Scope`, `Role`, `RoleDefinition`, `Permission`) comes from
 * `@nexora/contracts/identity`; plugins contribute definitions, the Policy
 * Engine evaluates them.
 */

import type { RoleDefinition, Permission, Scope } from '@nexora/contracts/identity';

/** A permission contribution: named permissions with granted scopes. */
export interface PermissionContribution {
  /** Contribution kind discriminant. */
  kind: 'permission';
  /** The permissions the plugin defines. */
  permissions: readonly Permission[];
}

/** A role contribution: roles the plugin introduces (e.g. `projects.lead`). */
export interface RoleContribution {
  /** Contribution kind discriminant. */
  kind: 'role';
  /** The role definitions the plugin introduces. */
  roles: readonly RoleDefinition[];
}

/** A policy contribution: policies the plugin registers (AIR.md §13). */
export interface PolicyContribution {
  /** Contribution kind discriminant. */
  kind: 'policy';
  /** Policy ids the plugin owns. */
  policyIds: readonly string[];
  /**
   * Scopes the plugin's policies govern. Policies evaluate actions against
   * scopes; the platform Policy Engine resolves the registered policy by id.
   */
  governs: readonly Scope[];
}

/** An approval contribution: approval rules the plugin requires (AIR.md §12). */
export interface ApprovalContribution {
  /** Contribution kind discriminant. */
  kind: 'approval';
  /** Approver role(s) required for plugin-defined consequential actions. */
  approverRoles: readonly string[];
  /** Whether plugin approvals may be delegated (AIR.md §12.6). */
  delegatable: boolean;
  /** Timeout before escalation, in milliseconds. */
  timeoutMs: number;
}
