/**
 * @nexora/module-domains — extensibility test (S24 Phase 1, MANDATORY).
 *
 * Adds a test-only `facilities` domain with roles and capabilities and
 * verifies it works WITHOUT modifying the core registry implementation: the
 * same registries that serve the initial catalog accept the new domain,
 * resolve it, and pass catalog integrity. (Legal is now itself part of the
 * initial catalog — this fixture uses a domain that genuinely is NOT.)
 *
 *   Facilities
 *   ├── Facilities Lead     → contracts.read, contracts.manage, compliance.read
 *   └── Facilities Manager  → contracts.read, compliance.read
 */

import { describe, expect, it } from 'vitest';
import type { CapabilityDefinition, DomainRoleDefinition } from '@nexora/contracts/domain';

import { assertCatalogIntegrity, createEmptyCatalog, createInitialCatalog } from '../src/index.js';

const FACILITIES_DOMAIN = {
  id: 'facilities',
  name: 'Facilities',
  description: 'Facilities and workplace operations',
  roleIds: ['facilities.lead', 'facilities.manager'],
} as const;

const FACILITIES_CAPABILITIES: readonly CapabilityDefinition[] = [
  { id: 'contracts.read', name: 'Read Contracts', description: 'Read contract records' },
  { id: 'contracts.manage', name: 'Manage Contracts', description: 'Manage contract records' },
  { id: 'compliance.read', name: 'Read Compliance', description: 'Read compliance records' },
];

const FACILITIES_ROLES: readonly DomainRoleDefinition[] = [
  {
    id: 'facilities.lead',
    name: 'Facilities Lead',
    description: 'Leads the facilities function',
    domainId: 'facilities',
    capabilityIds: ['contracts.read', 'contracts.manage', 'compliance.read'],
  },
  {
    id: 'facilities.manager',
    name: 'Facilities Manager',
    description: 'Manages facilities operations',
    domainId: 'facilities',
    capabilityIds: ['contracts.read', 'compliance.read'],
  },
];

describe('Facilities domain extensibility (no core changes)', () => {
  it('registers and resolves a Facilities domain on an empty catalog', () => {
    const catalog = createEmptyCatalog();

    for (const capability of FACILITIES_CAPABILITIES) {
      catalog.capabilities.register(capability);
    }
    catalog.domains.register(FACILITIES_DOMAIN);
    for (const role of FACILITIES_ROLES) {
      catalog.roles.register(role);
    }
    expect(() => assertCatalogIntegrity(catalog)).not.toThrow();

    // Resolution: domain → roles → capabilities.
    const domain = catalog.domains.get('facilities');
    expect(domain?.name).toBe('Facilities');
    expect(domain?.roleIds).toEqual(['facilities.lead', 'facilities.manager']);

    const roles = catalog.roles.resolveByDomain('facilities');
    expect(roles.map((role) => role.id)).toEqual(['facilities.lead', 'facilities.manager']);

    const facilitiesLead = catalog.roles.get('facilities.lead');
    expect(facilitiesLead?.capabilityIds).toEqual([
      'contracts.read',
      'contracts.manage',
      'compliance.read',
    ]);
    expect(catalog.capabilities.has('contracts.read')).toBe(true);
    expect(catalog.capabilities.has('contracts.manage')).toBe(true);
    expect(catalog.capabilities.has('compliance.read')).toBe(true);
    expect(catalog.capabilities.has('projects.read')).toBe(false);
  });

  it('registers a Facilities domain alongside the initial catalog without touching the core', () => {
    const catalog = createInitialCatalog();
    const coreRegistry = catalog.roles; // the SAME registry instance

    for (const capability of FACILITIES_CAPABILITIES) {
      catalog.capabilities.register(capability);
    }
    catalog.domains.register(FACILITIES_DOMAIN);
    for (const role of FACILITIES_ROLES) {
      catalog.roles.register(role);
    }
    expect(() => assertCatalogIntegrity(catalog)).not.toThrow();

    // The initial domains are untouched and still resolve.
    expect(catalog.domains.has('technology')).toBe(true);
    expect(catalog.roles.get('technology.cto')).toBeDefined();
    expect(catalog.roles.resolveByDomain('facilities')).toHaveLength(2);
    expect(catalog.roles).toBe(coreRegistry);
  });
});
