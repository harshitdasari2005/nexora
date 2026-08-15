/**
 * @nexora/module-domains — extensibility test (S24 Phase 1, MANDATORY).
 *
 * Adds a test-only `legal` domain with roles and capabilities and verifies
 * it works WITHOUT modifying the core registry implementation: the same
 * registries that serve the initial catalog accept the new domain, resolve
 * it, and pass catalog integrity.
 *
 *   Legal
 *   ├── General Counsel  → contracts.read, contracts.manage, compliance.read
 *   └── Legal Manager    → contracts.read, compliance.read
 */

import { describe, expect, it } from 'vitest';
import type { CapabilityDefinition, DomainRoleDefinition } from '@nexora/contracts/domain';

import { assertCatalogIntegrity, createEmptyCatalog, createInitialCatalog } from '../src/index.js';

const LEGAL_DOMAIN = {
  id: 'legal',
  name: 'Legal',
  description: 'Legal operations and compliance',
  roleIds: ['legal.general_counsel', 'legal.legal_manager'],
} as const;

const LEGAL_CAPABILITIES: readonly CapabilityDefinition[] = [
  { id: 'contracts.read', name: 'Read Contracts', description: 'Read contract records' },
  { id: 'contracts.manage', name: 'Manage Contracts', description: 'Manage contract records' },
  { id: 'compliance.read', name: 'Read Compliance', description: 'Read compliance records' },
];

const LEGAL_ROLES: readonly DomainRoleDefinition[] = [
  {
    id: 'legal.general_counsel',
    name: 'General Counsel',
    description: 'Leads the legal function',
    domainId: 'legal',
    capabilityIds: ['contracts.read', 'contracts.manage', 'compliance.read'],
  },
  {
    id: 'legal.legal_manager',
    name: 'Legal Manager',
    description: 'Manages legal operations',
    domainId: 'legal',
    capabilityIds: ['contracts.read', 'compliance.read'],
  },
];

describe('Legal domain extensibility (no core changes)', () => {
  it('registers and resolves a Legal domain on an empty catalog', () => {
    const catalog = createEmptyCatalog();

    for (const capability of LEGAL_CAPABILITIES) {
      catalog.capabilities.register(capability);
    }
    catalog.domains.register(LEGAL_DOMAIN);
    for (const role of LEGAL_ROLES) {
      catalog.roles.register(role);
    }
    expect(() => assertCatalogIntegrity(catalog)).not.toThrow();

    // Resolution: domain → roles → capabilities.
    const domain = catalog.domains.get('legal');
    expect(domain?.name).toBe('Legal');
    expect(domain?.roleIds).toEqual(['legal.general_counsel', 'legal.legal_manager']);

    const roles = catalog.roles.resolveByDomain('legal');
    expect(roles.map((role) => role.id)).toEqual(['legal.general_counsel', 'legal.legal_manager']);

    const generalCounsel = catalog.roles.get('legal.general_counsel');
    expect(generalCounsel?.capabilityIds).toEqual([
      'contracts.read',
      'contracts.manage',
      'compliance.read',
    ]);
    expect(catalog.capabilities.has('contracts.read')).toBe(true);
    expect(catalog.capabilities.has('contracts.manage')).toBe(true);
    expect(catalog.capabilities.has('compliance.read')).toBe(true);
    expect(catalog.capabilities.has('projects.read')).toBe(false);
  });

  it('registers a Legal domain alongside the initial catalog without touching the core', () => {
    const catalog = createInitialCatalog();
    const coreRegistry = catalog.roles; // the SAME registry instance

    for (const capability of LEGAL_CAPABILITIES) {
      catalog.capabilities.register(capability);
    }
    catalog.domains.register(LEGAL_DOMAIN);
    for (const role of LEGAL_ROLES) {
      catalog.roles.register(role);
    }
    expect(() => assertCatalogIntegrity(catalog)).not.toThrow();

    // The initial domains are untouched and still resolve.
    expect(catalog.domains.has('technology')).toBe(true);
    expect(catalog.roles.get('technology.cto')).toBeDefined();
    expect(catalog.roles.resolveByDomain('legal')).toHaveLength(2);
    expect(catalog.roles).toBe(coreRegistry);
  });
});
