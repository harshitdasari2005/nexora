/**
 * @nexora/module-agents — registry + validation tests (S26 Phase 8).
 *
 * Covers the generic agent engine:
 * - valid registration, duplicate rejection, lookup, list, role resolution
 * - deterministic validation: unknown role, mismatched domain, unknown
 *   autonomy level, out-of-set goal capabilities, duplicate goal/policy ids
 * - the INITIAL_AGENTS seed resolves for CEO/Manager/Developer
 * - extensibility: a test-only Legal agent registers without engine changes
 */

import { describe, expect, it } from 'vitest';
import type { BusinessAgentDefinition } from '@nexora/contracts/agent';
import { createInitialCatalog } from '@nexora/module-domains';

import {
  BusinessAgentRegistry,
  DuplicateAgentError,
  InvalidAgentError,
  INITIAL_AGENTS,
  UnknownRoleReferenceError,
} from '../src/index.js';

/** The Phase 1 catalog as the validation port (role ids + domain ids). */
const catalog = createInitialCatalog();

/** A minimal valid agent fixture. */
function agentFixture(overrides: Partial<BusinessAgentDefinition> = {}): BusinessAgentDefinition {
  return {
    id: 'executive',
    name: 'Executive Agent',
    domainId: 'executive',
    roleId: 'executive.ceo',
    description: 'Organization-level oversight.',
    autonomyLevel: 'governed_execution',
    capabilityIds: ['projects.find_project', 'notifications.what_needs_attention'],
    goals: [
      {
        id: 'attention',
        name: 'Identify what needs attention',
        description: 'Surfaces real attention items.',
        capabilityIds: ['notifications.what_needs_attention'],
      },
    ],
    policies: [
      {
        id: 'writes.require_approval',
        statement: 'Writes execute only through the approval engine.',
      },
    ],
    ...overrides,
  };
}

describe('BusinessAgentRegistry (S26 Phase 8)', () => {
  it('registers a valid agent and resolves it by role', () => {
    const registry = new BusinessAgentRegistry(catalog);
    registry.register(agentFixture());
    expect(registry.get('executive')).toBeDefined();
    expect(registry.has('executive')).toBe(true);
    expect(registry.resolveByRole('executive.ceo')?.id).toBe('executive');
    expect(registry.list()).toHaveLength(1);
  });

  it('rejects duplicate agent ids', () => {
    const registry = new BusinessAgentRegistry(catalog);
    registry.register(agentFixture());
    expect(() => registry.register(agentFixture())).toThrow(DuplicateAgentError);
  });

  it('rejects an unknown role reference', () => {
    const registry = new BusinessAgentRegistry(catalog);
    expect(() => registry.register(agentFixture({ roleId: 'executive.nonexistent' }))).toThrow(
      UnknownRoleReferenceError,
    );
  });

  it('rejects a role whose domain does not match the declared domain', () => {
    const registry = new BusinessAgentRegistry(catalog);
    expect(() =>
      registry.register(agentFixture({ domainId: 'finance', roleId: 'executive.ceo' })),
    ).toThrow(InvalidAgentError);
  });

  it('rejects an unknown autonomy level', () => {
    const registry = new BusinessAgentRegistry(catalog);
    expect(() =>
      registry.register(
        agentFixture({ autonomyLevel: 'unrestricted' as BusinessAgentDefinition['autonomyLevel'] }),
      ),
    ).toThrow(InvalidAgentError);
  });

  it('rejects a goal referencing a capability outside the agent set', () => {
    const registry = new BusinessAgentRegistry(catalog);
    expect(() =>
      registry.register(
        agentFixture({
          goals: [
            {
              id: 'bad',
              name: 'Bad goal',
              description: 'References an out-of-set capability.',
              capabilityIds: ['calendar.create_event'],
            },
          ],
        }),
      ),
    ).toThrow(InvalidAgentError);
  });

  it('rejects duplicate goal ids and duplicate policy ids', () => {
    const registry = new BusinessAgentRegistry(catalog);
    expect(() =>
      registry.register(
        agentFixture({
          goals: [
            agentFixture().goals[0]!,
            { id: 'attention', name: 'Dup', description: 'Dup', capabilityIds: [] },
          ],
        }),
      ),
    ).toThrow(InvalidAgentError);
    expect(() =>
      registry.register(
        agentFixture({
          policies: [
            { id: 'p', statement: 'a' },
            { id: 'p', statement: 'b' },
          ],
        }),
      ),
    ).toThrow(InvalidAgentError);
  });

  it('resolves an unknown role to undefined (fails safe, no throw)', () => {
    const registry = new BusinessAgentRegistry(catalog);
    registry.register(agentFixture());
    expect(registry.resolveByRole('finance.cfo')).toBeUndefined();
  });

  it('the INITIAL_AGENTS seed registers and resolves CEO/Manager/Developer', () => {
    const registry = new BusinessAgentRegistry(catalog);
    for (const agent of INITIAL_AGENTS) {
      registry.register(agent);
    }
    expect(registry.list()).toHaveLength(3);
    expect(registry.resolveByRole('executive.ceo')?.id).toBe('executive');
    expect(registry.resolveByRole('delivery.manager')?.id).toBe('manager');
    expect(registry.resolveByRole('technology.developer')?.id).toBe('developer');
    // Roles without an agent fail safely.
    expect(registry.resolveByRole('finance.cfo')).toBeUndefined();
  });

  it('extensibility: a test-only Legal agent registers without engine changes', () => {
    const registry = new BusinessAgentRegistry(catalog);
    for (const agent of INITIAL_AGENTS) {
      registry.register(agent);
    }
    const legal: BusinessAgentDefinition = {
      id: 'legal',
      name: 'Legal Agent',
      domainId: 'legal',
      roleId: 'legal.general_counsel',
      description: 'Contract and compliance focus.',
      autonomyLevel: 'read_only',
      capabilityIds: ['knowledge.search'],
      goals: [
        {
          id: 'legal.compliance',
          name: 'Identify compliance context',
          description: 'Finds real compliance-relevant knowledge.',
          capabilityIds: ['knowledge.search'],
        },
      ],
      policies: [{ id: 'reads.tenant_scoped', statement: 'Reads stay tenant-scoped.' }],
    };
    // A Legal domain/role must first be registered in the Phase 1 catalog —
    // the engine's validation enforces the same rule as every other module.
    // To prove extensibility WITHOUT touching the core engine, register a
    // role under an EXISTING domain (the catalog is the only constraint).
    const legalUnderTechnology = {
      ...legal,
      domainId: 'technology',
      roleId: 'technology.engineering_manager',
      name: 'Legal Agent (technology scope)',
    };
    expect(() => registry.register(legalUnderTechnology)).not.toThrow();
    expect(registry.resolveByRole('technology.engineering_manager')?.id).toBe('legal');
  });
});
