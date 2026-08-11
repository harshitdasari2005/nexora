/**
 * @nexora/domain-identity — PermissionDomainService.
 *
 * Evaluates permission requests against role assignments (PSD.md §10,
 * API_CONTRACTS.md §8). The service resolves role names to their permission
 * sets and produces a canonical `PermissionDecision` (deny-wins; approval is
 * a separate concern of the Approval Engine).
 */

import type { Result } from '@nexora/shared/result';
import { ok, err } from '@nexora/shared/result';
import type { Scope } from '@nexora/contracts/identity';
import type { PermissionDecision } from '@nexora/contracts/identity';

import type { Role } from '../entities/role.js';
import type { Permission } from '../entities/permission.js';
import { RoleNotFoundError, toIdentityError } from '../errors/index.js';
import type { RoleRepository } from '../repositories/index.js';

/** A permission request: name plus optional required scopes. */
export interface PermissionRequest {
  /** The permission name, e.g. `projects.create`. */
  name: string;
  /** Scopes that must be satisfied; empty means any grant of the name. */
  scopes?: readonly Scope[];
}

/** Dependencies of the {@link PermissionDomainService}. */
export interface PermissionDomainServiceDependencies {
  /** Role persistence (resolving role names to permission sets). */
  roles: RoleRepository;
}

/**
 * Evaluates whether a principal with the given roles holds a permission.
 */
export class PermissionDomainService {
  readonly #roles: RoleRepository;

  constructor(dependencies: PermissionDomainServiceDependencies) {
    this.#roles = dependencies.roles;
  }

  /**
   * Evaluates a permission request for a set of roles. Resolves every role
   * and returns a canonical {@link PermissionDecision}. Deny-wins: missing
   * roles, missing permissions, and scope mismatches all deny.
   */
  async can(
    roleNames: readonly string[],
    request: PermissionRequest,
  ): Promise<Result<PermissionDecision, RoleNotFoundError>> {
    try {
      const roles: Role[] = [];
      for (const name of roleNames) {
        const role = await this.#roles.findByName(name);
        if (role === undefined) {
          throw new RoleNotFoundError({ role: name });
        }
        roles.push(role);
      }

      const grantedBy: Scope[] = [];
      for (const role of roles) {
        const scopes = role.scopesFor(request.name);
        if (scopes.length > 0) {
          grantedBy.push(...scopes);
        }
      }

      if (grantedBy.length === 0) {
        return ok({ allowed: false, requiresApproval: false });
      }

      const requiredScopes = request.scopes ?? [];
      const scopeSatisfied =
        requiredScopes.length === 0 ||
        requiredScopes.some((required) => grantedBy.includes(required));

      return ok({
        allowed: scopeSatisfied,
        grantedBy: scopeSatisfied ? [...new Set(grantedBy)] : undefined,
        requiresApproval: false,
      });
    } catch (error) {
      return err(toIdentityError(error) as RoleNotFoundError);
    }
  }

  /**
   * The union of permissions granted across a set of roles (deduplicated by
   * name, first role wins).
   */
  async effectivePermissions(
    roleNames: readonly string[],
  ): Promise<Result<readonly Permission[], RoleNotFoundError>> {
    try {
      const byName = new Map<string, Permission>();
      for (const name of roleNames) {
        const role = await this.#roles.findByName(name);
        if (role === undefined) {
          throw new RoleNotFoundError({ role: name });
        }
        for (const permission of role.permissions) {
          if (!byName.has(permission.name)) {
            byName.set(permission.name, permission);
          }
        }
      }
      return ok([...byName.values()]);
    } catch (error) {
      return err(toIdentityError(error) as RoleNotFoundError);
    }
  }
}
