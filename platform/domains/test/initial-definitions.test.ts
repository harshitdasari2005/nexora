/**
 * @nexora/module-domains — initial registration tests (S24 Phase 1; S34 RBAC).
 *
 * The first-party seed registers the 12 initial domains, 23 initial roles,
 * and 40 initial capabilities (S24 Phase 3 added the executable AI
 * vocabulary: workspaces.list/create, projects.assign, calendar.create;
 * S25 Phase 7 added the external connector vocabulary: github.* and
 * slack.*; S27 Phase 6 added the legal/operations/customersuccess/procurement
 * domains and roles as an honest, capability-free catalog extension; S34
 * added the RBAC permission vocabulary: organization.read, problems.read/
 * .investigate, insights.read, agent.use/.execute, approvals.decide,
 * activity.read, calendar.read; the Audit Center added audit.read, granted
 * to executive.ceo and both legal roles; policy administration added
 * policy.read/.manage (manage: executive.ceo + legal.general_counsel; read:
 * those + legal.compliance_manager + finance.cfo; both non-delegable); S35 (Finance vertical) added
 * budgets.read/.manage, expenses.read/.create/.decide, granted to
 * finance.cfo only; backend RBAC enforcement added integrations.manage and
 * marketplace.manage, granted to executive.ceo, technology.cto/
 * .engineering_manager, and operations.manager); every relationship
 * resolves; catalog integrity passes; and re-registration fails fast
 * (startup validation, never silent drift).
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
  'legal',
  'operations',
  'customersuccess',
  'procurement',
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
  'requisitions.create',
  'requisitions.read',
  'requisitions.approve_executive',
  'requisitions.approve_finance',
  'recruiting.manage',
  'recruiting.read',
  'recruiting.interview',
  'workflows.read',
  'workflows.execute',
  'approvals.read',
  'approvals.create',
  'workspaces.list',
  'workspaces.create',
  'projects.assign',
  'calendar.create',
  'github.repositories.read',
  'github.issues.read',
  'github.issues.create',
  'slack.channels.read',
  'slack.messages.read',
  'slack.messages.send',
  'organization.read',
  'problems.read',
  'problems.investigate',
  'insights.read',
  'agent.use',
  'agent.execute',
  'approvals.decide',
  'activity.read',
  'calendar.read',
  'audit.read',
  'policy.read',
  'policy.manage',
  'budgets.read',
  'budgets.manage',
  'expenses.read',
  'expenses.create',
  'expenses.decide',
  'integrations.manage',
  'marketplace.manage',
  'agents.manage',
];

describe('initial domain registrations', () => {
  it('registers the 12 initial domains', () => {
    const catalog = createInitialCatalog();
    expect(catalog.domains.list().map((domain) => domain.id)).toEqual(EXPECTED_DOMAIN_IDS);
  });

  it('registers the 23 initial roles with their domains', () => {
    const catalog = createInitialCatalog();
    const roles = catalog.roles.list();
    expect(roles).toHaveLength(23);

    // Every role resolves its domain and is listed by it (integrity).
    for (const role of roles) {
      expect(role.domainId).toBe(catalog.domains.get(role.id.split('.')[0] ?? '')?.id);
    }
  });

  it('registers the 40 initial capabilities', () => {
    const catalog = createInitialCatalog();
    expect(catalog.capabilities.list().map((capability) => capability.id)).toEqual(
      EXPECTED_CAPABILITY_IDS,
    );
  });

  it('splits the hiring-request chain across roles: raise, executive decision, finance decision', () => {
    const catalog = createInitialCatalog();
    const holders = (capability: string): string[] =>
      catalog.roles
        .list()
        .filter((role) => role.capabilityIds.includes(capability))
        .map((role) => role.id)
        .sort();
    expect(holders('requisitions.create')).toEqual([
      'delivery.manager',
      'executive.ceo',
      'technology.cto',
      'technology.engineering_manager',
    ]);
    // Each decision stage belongs to exactly one role — and they are different roles.
    expect(holders('requisitions.approve_executive')).toEqual(['executive.ceo']);
    expect(holders('requisitions.approve_finance')).toEqual(['finance.cfo']);
    expect(holders('requisitions.read')).toEqual(['executive.ceo', 'finance.cfo', 'people.hr']);
  });

  it('grants policy.read / policy.manage only to the governance roles', () => {
    const catalog = createInitialCatalog();
    const holders = (capability: string): string[] =>
      catalog.roles
        .list()
        .filter((role) => role.capabilityIds.includes(capability))
        .map((role) => role.id)
        .sort();
    expect(holders('policy.manage')).toEqual(['executive.ceo', 'legal.general_counsel']);
    expect(holders('policy.read')).toEqual([
      'executive.ceo',
      'finance.cfo',
      'legal.compliance_manager',
      'legal.general_counsel',
    ]);
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
    expect(catalog.roles.resolveByDomain('legal').map((role) => role.id)).toEqual([
      'legal.general_counsel',
      'legal.compliance_manager',
    ]);
    expect(catalog.roles.resolveByDomain('operations').map((role) => role.id)).toEqual([
      'operations.head',
      'operations.manager',
    ]);
    expect(catalog.roles.resolveByDomain('customersuccess').map((role) => role.id)).toEqual([
      'customersuccess.manager',
      'customersuccess.support_manager',
    ]);
    expect(catalog.roles.resolveByDomain('procurement').map((role) => role.id)).toEqual([
      'procurement.manager',
      'procurement.vendor_manager',
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
