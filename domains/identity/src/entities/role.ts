/**
 * @nexora/domain-identity — Role aggregate root.
 *
 * A named, leveled role with its permission set (DOMAIN_MODEL.md §2.2,
 * PSD.md §10 permission model). Owns the {@link Permission} child entities.
 * Invariants: role names are unique per tenant, permission names are unique
 * within a role, and permissions always carry at least one scope.
 */

import { prefixedId } from '@nexora/shared/ids';
import { nowIso } from '@nexora/shared/time';
import type { Role as RoleName, RoleLevel, Scope } from '@nexora/contracts/identity';
import type { TenantId } from '@nexora/contracts/common';

import { DuplicatePermissionError, PermissionNotFoundError } from '../errors/index.js';
import { RoleInvariants } from '../policies/index.js';
import { Permission, type CreatePermissionInput } from './permission.js';

/** Input for creating a new {@link Role}. */
export interface CreateRoleInput {
  /** The role name, e.g. `workspace.admin`. */
  name: RoleName;
  /** The level the role applies at (PSD.md §10). */
  level: RoleLevel;
  /**
   * The tenant the role belongs to. Omitted roles are platform-global
   * templates visible to every tenant (role names are unique per tenant
   * when scoped, PSD.md §10).
   */
  tenantId?: TenantId;
  /** Whether the role may approve consequential actions. */
  approver?: boolean;
  /** Optional description of the role's purpose. */
  description?: string;
  /** Initial permissions to grant. */
  permissions?: readonly CreatePermissionInput[];
}

/**
 * A persistence snapshot of the {@link Role} aggregate (PERSISTENCE.md §4
 * aggregate ownership). Plain data produced by {@link Role.snapshot} and
 * consumed by {@link Role.hydrate} — no behavior.
 */
export interface RoleSnapshot {
  /** The role id. */
  id: string;
  /** The role name. */
  name: RoleName;
  /** The level the role applies at. */
  level: RoleLevel;
  /** The tenant the role belongs to, or `undefined` for platform-global. */
  tenantId?: TenantId;
  /** Whether the role may approve consequential actions. */
  approver: boolean;
  /** Optional description. */
  description?: string;
  /** The granted permissions (child entities). */
  permissions: readonly {
    /** The permission name. */
    name: string;
    /** The scopes granted. */
    scopes: readonly Scope[];
  }[];
  /** ISO-8601 UTC creation time. */
  createdAt: string;
  /** Monotonic version for optimistic concurrency. */
  version: number;
}

/**
 * The {@link Role} aggregate root. Use {@link Role.create} to construct;
 * mutate the permission set only through aggregate methods.
 */
export class Role {
  // Not `readonly`: reassigned only by `hydrate` (reconstitution).
  #id: string;
  readonly #name: RoleName;
  readonly #level: RoleLevel;
  readonly #tenantId?: TenantId;
  readonly #approver: boolean;
  readonly #description?: string;
  readonly #permissions: Permission[] = [];
  #createdAt: string;
  #version: number;

  private constructor(input: CreateRoleInput, createdAt: string) {
    this.#id = prefixedId('rol') as string;
    this.#name = input.name;
    this.#level = input.level;
    this.#tenantId = input.tenantId;
    this.#approver = input.approver ?? false;
    this.#description = input.description?.trim();
    this.#createdAt = createdAt;
    this.#version = 1;
  }

  /**
   * Creates a new {@link Role}, validating name and level.
   *
   * @param input - role data.
   * @param now   - ISO-8601 UTC creation time (defaults to now).
   * @throws {InvalidIdentityValueError} when the name or level are invalid.
   */
  static create(input: CreateRoleInput, now = nowIso()): Role {
    new RoleInvariants().assertValidRole(input.name, input.level);
    const role = new Role(input, now);
    for (const permission of input.permissions ?? []) {
      role.grantPermission(permission.name, permission.scopes);
    }
    return role;
  }

  /** The role id. */
  get id(): string {
    return this.#id;
  }

  /** The role name. */
  get name(): RoleName {
    return this.#name;
  }

  /** The tenant this role belongs to, or `undefined` when platform-global. */
  get tenantId(): TenantId | undefined {
    return this.#tenantId;
  }

  /** The level the role applies at. */
  get level(): RoleLevel {
    return this.#level;
  }

  /** Whether the role may approve consequential actions. */
  get approver(): boolean {
    return this.#approver;
  }

  /** Optional description of the role's purpose. */
  get description(): string | undefined {
    return this.#description;
  }

  /** The permissions granted by this role (child entities). */
  get permissions(): readonly Permission[] {
    return [...this.#permissions];
  }

  /** ISO-8601 UTC creation time. */
  get createdAt(): string {
    return this.#createdAt;
  }

  /** Monotonic version for optimistic concurrency. */
  get version(): number {
    return this.#version;
  }

  /** Whether the role grants the given permission name. */
  hasPermission(name: string): boolean {
    return this.#permissions.some((permission) => permission.name === name);
  }

  /** The scopes granted for a permission name (empty when not granted). */
  scopesFor(name: string): readonly Scope[] {
    return this.#permissions.find((permission) => permission.name === name)?.scopes ?? [];
  }

  /**
   * Grants a permission to the role.
   *
   * @param name   - the permission name.
   * @param scopes - the scopes granted.
   * @throws {DuplicatePermissionError} when the permission already exists.
   * @throws {InvalidIdentityValueError} when the permission is invalid.
   */
  grantPermission(name: string, scopes: readonly Scope[]): void {
    if (this.hasPermission(name)) {
      throw new DuplicatePermissionError({ roleId: this.#id, permission: name });
    }
    this.#permissions.push(Permission.create({ name, scopes }));
    this.#version += 1;
  }

  /**
   * Revokes a permission from the role.
   *
   * @param name - the permission name.
   * @throws {PermissionNotFoundError} when the permission does not exist.
   */
  revokePermission(name: string): void {
    const index = this.#permissions.findIndex((permission) => permission.name === name);
    if (index === -1) {
      throw new PermissionNotFoundError({ roleId: this.#id, permission: name });
    }
    this.#permissions.splice(index, 1);
    this.#version += 1;
  }

  /**
   * Produces a persistence snapshot of the role (PERSISTENCE.md §4 aggregate
   * ownership).
   */
  static snapshot(role: Role): RoleSnapshot {
    return {
      id: role.id,
      name: role.name,
      level: role.level,
      tenantId: role.tenantId,
      approver: role.approver,
      description: role.description,
      permissions: role.permissions.map((permission) => ({
        name: permission.name,
        scopes: permission.scopes,
      })),
      createdAt: role.createdAt,
      version: role.version,
    };
  }

  /**
   * Reconstructs a {@link Role} from a persistence snapshot without emitting
   * domain events (DDD reconstitution factory).
   */
  static hydrate(snapshot: RoleSnapshot): Role {
    const role = new Role(
      {
        name: snapshot.name,
        level: snapshot.level,
        tenantId: snapshot.tenantId,
        approver: snapshot.approver,
        description: snapshot.description,
      },
      snapshot.createdAt,
    );
    role.#id = snapshot.id;
    role.#version = snapshot.version;
    for (const permission of snapshot.permissions) {
      role.#permissions.push(
        Permission.create({ name: permission.name, scopes: permission.scopes }),
      );
    }
    return role;
  }
}
