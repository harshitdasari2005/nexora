/**
 * @nexora/module-domains — security contract tests (S24 Phase 1).
 *
 * ROLE ≠ PERMISSION, and the server — never the model or the client —
 * grants access:
 *
 * - Role resolution never grants authorization: the catalog exposes
 *   definitions only (no permissions, scopes, approver flags, or levels).
 * - A forged role (an id claiming a domain it does not belong to) is
 *   rejected at registration.
 * - A forged capability cannot bypass authorization: the registry binds no
 *   capability to any executable or authorization surface.
 * - Tenant/workspace boundaries are untouched: the module has no tenant,
 *   workspace, or user concept — definitions are platform-global vocabulary.
 */

import { describe, expect, it } from 'vitest';
import type { DomainRoleDefinition } from '@nexora/contracts/domain';

import {
  DomainApplicationService,
  InvalidDefinitionError,
  UnknownReferenceError,
  createEmptyCatalog,
} from '../src/index.js';

/** Builds a catalog with one domain and one capability. */
function baseCatalog() {
  const catalog = createEmptyCatalog();
  catalog.capabilities.register({ id: 'projects.read', name: 'Read Projects' });
  catalog.domains.register({ id: 'technology', name: 'Technology', roleIds: ['technology.cto'] });
  catalog.roles.register({
    id: 'technology.cto',
    name: 'CTO',
    domainId: 'technology',
    capabilityIds: ['projects.read'],
  });
  return catalog;
}

describe('role ≠ permission (S24 security contract)', () => {
  it('exposes definitions only — no authorization fields in the catalog view', () => {
    const view = new DomainApplicationService(baseCatalog()).getCatalogView();

    for (const domain of view.domains) {
      expect(Object.keys(domain).sort()).toEqual(['id', 'name', 'roles']);
      for (const role of domain.roles) {
        // Business context only: no permissions, scopes, approver, or level.
        expect(Object.keys(role).sort()).toEqual(['capabilityIds', 'id', 'name']);
        expect(role).not.toHaveProperty('permissions');
        expect(role).not.toHaveProperty('scopes');
        expect(role).not.toHaveProperty('approver');
        expect(role).not.toHaveProperty('level');
      }
    }
    for (const capability of view.capabilities) {
      expect(Object.keys(capability).sort()).toEqual(['id', 'name']);
      expect(capability).not.toHaveProperty('toolId');
      expect(capability).not.toHaveProperty('sideEffectClass');
    }
  });

  it('exposes no tenant, workspace, or user context (platform-global vocabulary)', () => {
    const view = new DomainApplicationService(baseCatalog()).getCatalogView();
    const serialized = JSON.stringify(view);

    expect(serialized).not.toContain('tenantId');
    expect(serialized).not.toContain('workspaceId');
    expect(serialized).not.toContain('userId');
    expect(serialized).not.toContain('organizationId');
  });

  it('rejects a forged role id that claims another domain (cannot widen scope)', () => {
    const catalog = createEmptyCatalog();
    catalog.capabilities.register({ id: 'projects.read', name: 'Read Projects' });
    catalog.domains.register({ id: 'technology', name: 'Technology', roleIds: [] });
    // The executive domain EXISTS, so the mismatch is the id/domainId
    // association itself — not an unknown domain — and must be rejected.
    catalog.domains.register({ id: 'executive', name: 'Executive', roleIds: [] });

    const forged: DomainRoleDefinition = {
      // The id claims the technology domain...
      id: 'technology.cto',
      name: 'CTO',
      // ...but the domainId claims executive — rejected.
      domainId: 'executive',
      capabilityIds: ['projects.read'],
    };

    expect(() => catalog.roles.register(forged)).toThrow(InvalidDefinitionError);
  });

  it('rejects a role referencing a capability that is not registered vocabulary', () => {
    const catalog = createEmptyCatalog();
    catalog.capabilities.register({ id: 'projects.read', name: 'Read Projects' });
    catalog.domains.register({ id: 'technology', name: 'Technology', roleIds: [] });

    const forged: DomainRoleDefinition = {
      id: 'technology.cto',
      name: 'CTO',
      domainId: 'technology',
      capabilityIds: ['finance.approve_payments'],
    };

    expect(() => catalog.roles.register(forged)).toThrow(UnknownReferenceError);
  });

  it('provides no authorization entry point on any registry', () => {
    const catalog = baseCatalog();
    // The registries and the application service expose resolution/listing
    // only — there is no `can()`, `authorize()`, or `evaluate()` surface to
    // even attempt a grant. Assert the public surface is read-only.
    const service = new DomainApplicationService(catalog);
    expect(typeof service.getCatalogView).toBe('function');
    expect((service as unknown as Record<string, unknown>)['can']).toBeUndefined();
    expect((catalog.roles as unknown as Record<string, unknown>)['can']).toBeUndefined();
    expect(
      (catalog.capabilities as unknown as Record<string, unknown>)['authorize'],
    ).toBeUndefined();
  });
});
