/**
 * @nexora/module-agents — BusinessAgentRegistry (S26 Phase 8).
 *
 * The registry of {@link BusinessAgentDefinition}s. Definitions are
 * registered at startup from code/config; registration is validated
 * deterministically (duplicates, role/capability integrity, autonomy
 * bounds) and throws on invalid configuration — never discovered
 * mid-request. Resolution is a plain in-memory read (no per-request scans,
 * S22 budgets preserved).
 *
 * The registry is the extension seam: a new role (e.g.
 * `legal.general_counsel`) registers its agent here without any change to
 * the generic engine. The engine resolves definitions, never job titles.
 */

import type { BusinessAgentDefinition } from '@nexora/contracts/agent';
import { DuplicateAgentError } from '../errors.js';
import {
  validateAgentDefinition,
  type AgentCatalogForValidation,
} from '../validation/definitions.js';

/** The registry of business-agent definitions. */
export class BusinessAgentRegistry {
  readonly #definitions = new Map<string, BusinessAgentDefinition>();

  constructor(private readonly catalog: AgentCatalogForValidation) {}

  /**
   * Registers an agent definition, validating it first.
   *
   * @throws {InvalidAgentError} when the definition is invalid.
   * @throws {UnknownRoleReferenceError} when the bound role does not resolve.
   * @throws {DuplicateAgentError} when the id is already registered.
   */
  register(def: BusinessAgentDefinition): void {
    validateAgentDefinition(def, this.catalog);
    if (this.#definitions.has(def.id)) {
      throw new DuplicateAgentError(def.id);
    }
    this.#definitions.set(def.id, def);
  }

  /** Resolves an agent by id, or `undefined`. */
  get(id: string): BusinessAgentDefinition | undefined {
    return this.#definitions.get(id);
  }

  /** Whether an agent with the id is registered. */
  has(id: string): boolean {
    return this.#definitions.has(id);
  }

  /** All registered agents, in registration order. */
  list(): readonly BusinessAgentDefinition[] {
    return [...this.#definitions.values()];
  }

  /**
   * Resolves the agent bound to a business role, or `undefined` when the
   * role has no agent (fails safe: no data, no error surfaced from an
   * unknown role).
   */
  resolveByRole(roleId: string): BusinessAgentDefinition | undefined {
    return [...this.#definitions.values()].find((def) => def.roleId === roleId);
  }
}
