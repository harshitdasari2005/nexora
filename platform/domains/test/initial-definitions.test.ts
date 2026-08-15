/**
 * @nexora/module-domains — initial registration tests (S24 Phase 1).
 *
 * The first-party seed registers the 8 initial domains, 15 initial roles,
 * and 17 initial capabilities (S24 Phase 3 added the executable AI
 * vocabulary: workspaces.list/create, projects.assign, calendar.create);
 * every relationship resolves; catalog integrity passes; and
 * re-registration fails fast (startup validation, never silent drift).
 */

import { describe, expect, it } from 'vitest';

import {
  DuplicateDefinitionError,
  createEmptyCatalog,
  createInitialCatalog,
  registerInitialDefinitions,
} from '../src/index.js';

const EXPECTED_DOMAIN_IDS = [
  'executive',
  'finance',
  'people',
  'technology',
  'security',
  'growth',
  'product',
  'delivery',
];

const EXPECTED_CAPABILITY_IDS = [
  'projects.read',
  'projects.create',
  'projects.update',
  'documents.read',
  'documents.upload',
  'knowledge.read',
  'knowledge.publish',
  'employees.read',
  'employees.manage',
  'workflows.read',
  'workflows.execute',
  'approvals.read',
  'approvals.create',
  'workspaces.list',
  'workspaces.create',
  'projects.assign',
  'calendar.create',
];

describe('initial domain registrations', () => {
  it('registers the 8 initial domains', () => {
    const catalog = createInitialCatalog();
    expect(catalog.domains.list().map((domain) => domain.id)).toEqual(EXPECTED_DOMAIN_IDS);
  });

  it('registers the 15 initial roles with their domains', () => {
    const catalog = createInitialCatalog();
    const roles = catalog.roles.list();
    expect(roles).toHaveLength(15);

    // Every role resolves its domain and is listed by it (integrity).
    for (const role of roles) {
      expect(role.domainId).toBe(catalog.domains.get(role.id.split('.')[0] ?? '')?.id);
    }
  });

  it('registers the 17 initial capabilities', () => {
    const catalog = createInitialCatalog();
    expect(catalog.capabilities.list().map((capability) => capability.id)).toEqual(
      EXPECTED_CAPABILITY_IDS,
    );
  });

  it('registers the expected roles per domain', () => {
    const catalog = createInitialCatalog();
    expect(catalog.roles.resolveByDomain('executive').map((role) => role.id)).toEqual([
      'executive.ceo',
    ]);
    expect(catalog.roles.resolveByDomain('finance').map((role) => role.id)).toEqual([
      'finance.cfo',
    ]);
    expect(catalog.roles.resolveByDomain('people').map((role) => role.id)).toEqual(['people.hr']);
    expect(catalog.roles.resolveByDomain('technology').map((role) => role.id)).toEqual([
      'technology.cto',
      'technology.engineering_manager',
      'technology.developer',
    ]);
    expect(catalog.roles.resolveByDomain('security').map((role) => role.id)).toEqual([
      'security.ciso',
      'security.security_manager',
    ]);
    expect(catalog.roles.resolveByDomain('growth').map((role) => role.id)).toEqual([
      'growth.sales_manager',
      'growth.marketing_manager',
      'growth.growth_manager',
    ]);
    expect(catalog.roles.resolveByDomain('product').map((role) => role.id)).toEqual([
      'product.product_manager',
      'product.product_lead',
    ]);
    expect(catalog.roles.resolveByDomain('delivery').map((role) => role.id)).toEqual([
      'delivery.manager',
      'delivery.project_manager',
    ]);
  });

  it('registers the expected role display names', () => {
    const catalog = createInitialCatalog();
    expect(catalog.roles.get('executive.ceo')?.name).toBe('CEO');
    expect(catalog.roles.get('finance.cfo')?.name).toBe('CFO');
    expect(catalog.roles.get('people.hr')?.name).toBe('HR / CHRO');
    expect(catalog.roles.get('technology.cto')?.name).toBe('CTO');
    expect(catalog.roles.get('technology.engineering_manager')?.name).toBe('Engineering Manager');
    expect(catalog.roles.get('technology.developer')?.name).toBe('Developer');
    expect(catalog.roles.get('delivery.project_manager')?.name).toBe('Project Manager');
  });

  it('registers every domain roleIds entry as a resolved role of that domain', () => {
    const catalog = createInitialCatalog();
    for (const domain of catalog.domains.list()) {
      for (const roleId of domain.roleIds) {
        const role = catalog.roles.get(roleId);
        expect(role).toBeDefined();
        expect(role?.domainId).toBe(domain.id);
      }
    }
  });

  it('re-registering the initial definitions fails fast (startup validation)', () => {
    const catalog = createEmptyCatalog();
    registerInitialDefinitions(catalog);
    expect(() => registerInitialDefinitions(catalog)).toThrow(DuplicateDefinitionError);
  });
});
