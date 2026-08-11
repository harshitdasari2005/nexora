/**
 * @nexora/domain-identity — Permission entity.
 *
 * A named permission with its scopes, owned by the {@link Role} aggregate.
 * Structurally compatible with the canonical `Permission` contract
 * (`@nexora/contracts/identity`) — the entity adds identity and validation
 * without redefining the contract shape.
 */

import { prefixedId } from '@nexora/shared/ids';
import type { Scope } from '@nexora/contracts/identity';

import { PermissionInvariants } from '../policies/index.js';

/** Input for creating a {@link Permission}. */
export interface CreatePermissionInput {
  /** The permission name, e.g. `projects.create`. */
  name: string;
  /** The scopes granted by this permission, e.g. `['projects:write']`. */
  scopes: readonly Scope[];
}

/**
 * A named permission owned by a {@link Role}. Immutable after creation;
 * roles mutate their permission set through aggregate methods.
 */
export class Permission {
  readonly #id: string;
  readonly #name: string;
  readonly #scopes: readonly Scope[];

  private constructor(id: string, name: string, scopes: readonly Scope[]) {
    this.#id = id;
    this.#name = name;
    this.#scopes = scopes;
  }

  /**
   * Creates a {@link Permission}, validating name and scopes.
   *
   * @param input - permission data.
   * @throws {InvalidIdentityValueError} when the name or scopes are invalid.
   */
  static create(input: CreatePermissionInput): Permission {
    new PermissionInvariants().assertValidPermission(input.name, input.scopes);
    return new Permission(prefixedId('per'), input.name, input.scopes);
  }

  /** The permission id. */
  get id(): string {
    return this.#id;
  }

  /** The permission name. */
  get name(): string {
    return this.#name;
  }

  /** The scopes granted by this permission. */
  get scopes(): readonly Scope[] {
    return [...this.#scopes];
  }

  /** Structural equality against another {@link Permission}. */
  equals(other: Permission): boolean {
    return this.#name === other.#name;
  }
}
