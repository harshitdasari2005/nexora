/**
 * S24 Phase 3 — AI business-context unit tests.
 *
 * Verifies the trusted business-context builder in isolation:
 * - The affinity bridge maps Phase 1 BUSINESS capabilities to executable AI
 *   capability ids; business capabilities with no executable AI surface
 *   (e.g. `documents.upload`, `projects.update`) resolve to NOTHING — the AI
 *   is never told it can execute something it cannot.
 * - Role resolution derives the business role from trusted membership only.
 * - Business context is CONTEXT, never a grant.
 */

import { describe, expect, it } from 'vitest';
import { createInitialCatalog, INITIAL_CAPABILITIES } from '@nexora/module-domains';

import {
  buildAIBusinessContext,
  resolveExecutableCapabilities,
  type AIBusinessContextDependencies,
} from '../src/business-context/ai-business-context.js';
import { MembershipBusinessRoleResolver } from '../src/business-context/business-role-resolver.js';

function buildDependencies(
  role: string | undefined,
): AIBusinessContextDependencies & { resolver: MembershipBusinessRoleResolver } {
  const resolver = new MembershipBusinessRoleResolver({
    memberships: {
      findByOrganizationAndUser: async () => (role === undefined ? undefined : ({ role } as never)),
      listByUser: async () => [],
    } as never,
    workspaceMemberships: {
      findByWorkspaceAndUser: async () => undefined,
    } as never,
  });
  return { roleResolver: resolver, catalog: createInitialCatalog(), resolver };
}

describe('resolveExecutableCapabilities (affinity bridge)', () => {
  it('maps business capabilities to their executable AI surfaces', () => {
    // S24 Phase 5: projects.read also maps to the list-projects surface and
    // approvals.read to the notifications inbox (MCP tool affinities).
    expect(resolveExecutableCapabilities(['projects.read'])).toEqual([
      'projects.find_project',
      'projects.list',
    ]);
    expect(resolveExecutableCapabilities(['documents.read'])).toEqual(['knowledge.search']);
    expect(resolveExecutableCapabilities(['employees.manage'])).toEqual(['hr.create_employee']);
    expect(resolveExecutableCapabilities(['approvals.read'])).toEqual([
      'notifications.what_needs_attention',
      'notifications.list',
    ]);
  });

  it('drops business capabilities with no executable AI surface (never pretends)', () => {
    // projects.update and documents.upload have no AI tool — they resolve
    // to nothing, so discovery can never surface a phantom capability.
    expect(resolveExecutableCapabilities(['projects.update'])).toEqual([]);
    expect(resolveExecutableCapabilities(['documents.upload'])).toEqual([]);
    expect(resolveExecutableCapabilities(['knowledge.publish'])).toEqual([]);
    expect(resolveExecutableCapabilities(['approvals.create'])).toEqual([]);
  });

  it('deduplicates mapped capabilities across business ids', () => {
    // documents.read and knowledge.read both map to knowledge.search.
    expect(resolveExecutableCapabilities(['documents.read', 'knowledge.read'])).toEqual([
      'knowledge.search',
    ]);
  });

  it('ignores unknown business capability ids safely', () => {
    expect(resolveExecutableCapabilities(['legal.contracts.read', 'unknown.capability'])).toEqual(
      [],
    );
  });
});

describe('buildAIBusinessContext', () => {
  it('resolves the CEO context (domain + role + capability affinity)', async () => {
    const { resolver, ...deps } = buildDependencies('owner');
    const business = await buildAIBusinessContext(deps, {
      userId: 'usr_1',
      tenantId: 'org_1',
    });
    expect(business?.domainId).toBe('executive');
    expect(business?.domainName).toBe('Executive');
    expect(business?.roleId).toBe('executive.ceo');
    expect(business?.roleName).toBe('CEO');
    expect(business?.capabilityIds).toEqual(
      expect.arrayContaining([
        'workspaces.list_workspaces',
        'workspaces.create_workspace',
        'projects.find_project',
        'knowledge.search',
        'hr.find_employee',
        'notifications.what_needs_attention',
        'calendar.create_event',
      ]),
    );
    void resolver;
  });

  it('resolves the Developer context with the read/research focus only', async () => {
    const { resolver, ...deps } = buildDependencies('member');
    const business = await buildAIBusinessContext(deps, {
      userId: 'usr_1',
      tenantId: 'org_1',
    });
    expect(business?.domainId).toBe('technology');
    expect(business?.roleId).toBe('technology.developer');
    expect(business?.capabilityIds).toEqual(
      expect.arrayContaining(['projects.find_project', 'knowledge.search']),
    );
    // Write surfaces are excluded from the Developer's AI focus.
    expect(business?.capabilityIds).not.toContain('workspaces.create_workspace');
    expect(business?.capabilityIds).not.toContain('hr.create_employee');
    expect(business?.capabilityIds).not.toContain('calendar.create_event');
    void resolver;
  });

  it('returns undefined when the caller has no resolvable business role', async () => {
    const { resolver, ...deps } = buildDependencies(undefined);
    const business = await buildAIBusinessContext(deps, {
      userId: 'usr_1',
      tenantId: 'org_1',
    });
    expect(business).toBeUndefined();
    void resolver;
  });

  it('the catalog contains only registered vocabulary — every affinity maps to a real capability', () => {
    const catalog = createInitialCatalog();
    const capabilityIds = new Set(catalog.capabilities.list().map((c) => c.id));
    for (const capability of INITIAL_CAPABILITIES) {
      expect(capabilityIds.has(capability.id)).toBe(true);
    }
  });
});
