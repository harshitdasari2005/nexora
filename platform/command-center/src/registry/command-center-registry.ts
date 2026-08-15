/**
 * @nexora/module-command-center — CommandCenterRegistry.
 *
 * The registry of {@link CommandCenterDefinition}s (S24 Phase 2).
 * Definitions are registered at startup from code/config; registration is
 * validated deterministically (duplicates, widget/action integrity, and the
 * bound role against the Phase 1 Domain → Role catalog) and throws on
 * invalid configuration — never discovered mid-request. Resolution is a
 * plain in-memory read (no per-request scans, S22 budgets preserved).
 *
 * The registry is the extension seam for future command centers: a new role
 * (e.g. `legal.general_counsel`) registers its command center here without
 * any change to the generic engine.
 */

import type { CommandCenterDefinition } from '@nexora/contracts/command-center';
import { DuplicateCommandCenterError } from '../errors.js';
import { validateCommandCenterDefinition } from '../validation/definitions.js';
import type { CommandCenterCatalogForValidation } from '../validation/definitions.js';

/** The registry of command-center definitions. */
export class CommandCenterRegistry {
  readonly #definitions = new Map<string, CommandCenterDefinition>();

  constructor(private readonly catalog: CommandCenterCatalogForValidation) {}

  /**
   * Registers a command-center definition, validating it first.
   *
   * @throws {InvalidCommandCenterError} when the definition is invalid.
   * @throws {UnknownRoleReferenceError} when the bound role does not resolve.
   * @throws {DuplicateCommandCenterError} when the id is already registered.
   */
  register(def: CommandCenterDefinition): void {
    validateCommandCenterDefinition(def, this.catalog);
    if (this.#definitions.has(def.id)) {
      throw new DuplicateCommandCenterError(def.id);
    }
    this.#definitions.set(def.id, def);
  }

  /** Resolves a command center by id, or `undefined`. */
  get(id: string): CommandCenterDefinition | undefined {
    return this.#definitions.get(id);
  }

  /** Whether a command center with the id is registered. */
  has(id: string): boolean {
    return this.#definitions.has(id);
  }

  /** All registered command centers, in registration order. */
  list(): readonly CommandCenterDefinition[] {
    return [...this.#definitions.values()];
  }

  /**
   * Resolves the command center bound to a business role, or `undefined`
   * when the role has no command center (fails safe: no data, no error
   * surfaced from an unknown role).
   */
  resolveByRole(roleId: string): CommandCenterDefinition | undefined {
    return [...this.#definitions.values()].find((def) => def.roleId === roleId);
  }
}
