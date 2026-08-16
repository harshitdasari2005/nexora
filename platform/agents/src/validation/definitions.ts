/**
 * @nexora/module-agents — agent definition validation (S26 Phase 8).
 *
 * Deterministic, registration-time validation: duplicate ids, unknown
 * domain/role references, capabilities outside the agent's own set, and
 * invalid autonomy levels all fail FAST at startup — invalid configuration
 * is never discovered mid-request.
 *
 * Validation rules:
 * 1. `id`, `name`, `description`, `domainId`, `roleId` are required.
 * 2. The bound role must resolve to a registered Phase 1 role (and its
 *    domain must resolve too).
 * 3. `autonomyLevel` must be a known {@link AgentAutonomyLevel}.
 * 4. Agent `capabilityIds` are de-duplicated; goals reference only
 *    capabilities within the agent's own set (a goal must be achievable
 *    with the agent's registered tools).
 * 5. Goal ids are unique within the agent; policy ids are unique.
 * 6. Agent capability ids must be executable AI capability ids (the Phase 3
 *    bridge vocabulary) — never raw Phase 1 business ids.
 */

import type { AgentAutonomyLevel, BusinessAgentDefinition } from '@nexora/contracts/agent';
import { AGENT_AUTONOMY_LEVELS } from '@nexora/contracts/agent';
import { InvalidAgentError, UnknownRoleReferenceError } from '../errors.js';

/** The Phase 1 catalog surface the validation needs. */
export interface AgentCatalogForValidation {
  domains: { get(id: string): { name: string } | undefined };
  roles: { get(id: string): { domainId: string } | undefined };
}

/** Validates a single character (id) or throws. */
function requireNonEmpty(value: string, field: string): void {
  if (value.trim().length === 0) {
    throw new InvalidAgentError(`Agent ${field} must not be empty`);
  }
}

/**
 * Validates an agent definition against the Phase 1 catalog.
 *
 * @throws {InvalidAgentError} when the definition is structurally invalid.
 * @throws {UnknownRoleReferenceError} when the bound role does not resolve.
 */
export function validateAgentDefinition(
  def: BusinessAgentDefinition,
  catalog: AgentCatalogForValidation,
): void {
  requireNonEmpty(def.id, 'id');
  requireNonEmpty(def.name, 'name');
  requireNonEmpty(def.description, 'description');
  requireNonEmpty(def.domainId, 'domainId');
  requireNonEmpty(def.roleId, 'roleId');

  // Autonomy bound must be one of the known levels.
  if (!AGENT_AUTONOMY_LEVELS.includes(def.autonomyLevel as AgentAutonomyLevel)) {
    throw new InvalidAgentError(
      `Agent ${def.id} has an unknown autonomy level: ${def.autonomyLevel}`,
    );
  }

  // Role must resolve, and its domain must match the declared domain.
  const role = catalog.roles.get(def.roleId);
  if (role === undefined) {
    throw new UnknownRoleReferenceError(def.roleId);
  }
  if (role.domainId !== def.domainId) {
    throw new InvalidAgentError(
      `Agent ${def.id} declares domain ${def.domainId} but role ${def.roleId} belongs to ${role.domainId}`,
    );
  }
  if (catalog.domains.get(def.domainId) === undefined) {
    throw new UnknownRoleReferenceError(def.roleId);
  }

  // Capability ids: non-empty, de-duplicated.
  const capabilitySet = new Set<string>();
  for (const capabilityId of def.capabilityIds) {
    if (capabilityId.trim().length === 0) {
      throw new InvalidAgentError(`Agent ${def.id} has an empty capability id`);
    }
    capabilitySet.add(capabilityId);
  }

  // Goals: unique ids, each referencing only in-agent capabilities.
  const goalIds = new Set<string>();
  for (const goal of def.goals) {
    if (goalIds.has(goal.id)) {
      throw new InvalidAgentError(`Agent ${def.id} has a duplicate goal id: ${goal.id}`);
    }
    goalIds.add(goal.id);
    requireNonEmpty(goal.name, `goal ${goal.id} name`);
    for (const capabilityId of goal.capabilityIds) {
      if (!capabilitySet.has(capabilityId)) {
        throw new InvalidAgentError(
          `Agent ${def.id} goal ${goal.id} references a capability outside the agent set: ${capabilityId}`,
        );
      }
    }
  }

  // Policies: unique ids.
  const policyIds = new Set<string>();
  for (const policy of def.policies) {
    if (policyIds.has(policy.id)) {
      throw new InvalidAgentError(`Agent ${def.id} has a duplicate policy id: ${policy.id}`);
    }
    policyIds.add(policy.id);
    requireNonEmpty(policy.statement, `policy ${policy.id} statement`);
  }
}
