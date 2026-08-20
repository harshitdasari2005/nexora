/**
 * S27 Phase 6 — MembershipBusinessRoleResolver workspace-type override.
 *
 * Verifies the workspace-aware role switching added on top of the existing
 * trusted membership resolution:
 * - Workspace types with no override entry (`engineering`, and no workspace
 *   at all) resolve through the EXACT original default mapping — zero
 *   behavior change for pre-existing callers.
 * - Workspace types WITH an override resolve to the type-specific business
 *   role, scoped by the caller's REAL membership role — never a role the
 *   client requested, only what trusted membership + workspace type imply.
 *   `general` (S33) is one such override: all three membership tiers are
 *   spent on the technology domain's own hierarchy (CTO/Engineering
 *   Manager/Developer) rather than falling through to the generic default.
 * - Omitting the `workspaces` dependency (older composition sites) falls
 *   back to the default mapping, never throws.
 */

import { describe, expect, it } from 'vitest';

import { MembershipBusinessRoleResolver } from '../src/business-context/business-role-resolver.js';

function fakeWorkspace(type: string) {
  return { type: { value: type } } as never;
}

function buildResolver(membershipRole: string, workspaceType: string | undefined) {
  return new MembershipBusinessRoleResolver({
    memberships: {
      findByOrganizationAndUser: async () => ({ role: membershipRole }) as never,
    } as never,
    workspaceMemberships: {
      findByWorkspaceAndUser: async () => ({ role: membershipRole }) as never,
    } as never,
    workspaces: {
      findById: async () =>
        workspaceType === undefined ? undefined : fakeWorkspace(workspaceType),
    } as never,
  });
}

describe('MembershipBusinessRoleResolver — workspace-type override (S27 Phase 6)', () => {
  it('resolves the original default mapping for the organization scope (no workspace)', async () => {
    const resolver = buildResolver('owner', undefined);
    const role = await resolver.resolve({ userId: 'usr_1', tenantId: 'org_1' });
    expect(role).toBe('executive.ceo');
  });

  it('resolves the original default mapping for the untouched `engineering` type', async () => {
    const resolver = buildResolver('member', 'engineering');
    const role = await resolver.resolve({
      userId: 'usr_1',
      tenantId: 'org_1',
      workspaceId: 'ws_1',
    });
    expect(role).toBe('technology.developer');
  });

  it('overrides `general` to the technology-domain hierarchy (S33) — owner/admin/member each resolve to a different, already-cataloged role', async () => {
    const owner = buildResolver('owner', 'general');
    expect(await owner.resolve({ userId: 'usr_1', tenantId: 'org_1', workspaceId: 'ws_1' })).toBe(
      'technology.cto',
    );

    const admin = buildResolver('admin', 'general');
    expect(await admin.resolve({ userId: 'usr_1', tenantId: 'org_1', workspaceId: 'ws_1' })).toBe(
      'technology.engineering_manager',
    );

    const member = buildResolver('member', 'general');
    expect(await member.resolve({ userId: 'usr_1', tenantId: 'org_1', workspaceId: 'ws_1' })).toBe(
      'technology.developer',
    );
  });

  it('does NOT override `engineering` (the existing demo workspace type) — the hero-flow owner still resolves executive.ceo', async () => {
    const owner = buildResolver('owner', 'engineering');
    expect(await owner.resolve({ userId: 'usr_1', tenantId: 'org_1', workspaceId: 'ws_1' })).toBe(
      'executive.ceo',
    );
  });

  it('overrides to the workspace-specific role, scoped by the real membership role', async () => {
    const owner = buildResolver('owner', 'legal');
    expect(await owner.resolve({ userId: 'usr_1', tenantId: 'org_1', workspaceId: 'ws_1' })).toBe(
      'legal.general_counsel',
    );

    const admin = buildResolver('admin', 'legal');
    expect(await admin.resolve({ userId: 'usr_1', tenantId: 'org_1', workspaceId: 'ws_1' })).toBe(
      'legal.compliance_manager',
    );

    const member = buildResolver('member', 'legal');
    expect(await member.resolve({ userId: 'usr_1', tenantId: 'org_1', workspaceId: 'ws_1' })).toBe(
      'legal.compliance_manager',
    );
  });

  it('every override resolves to an id already present in the Phase 1 catalog', async () => {
    const types = [
      'executive',
      'finance',
      'hr',
      'sales',
      'marketing',
      'product',
      'legal',
      'operations',
      'customer_success',
      'procurement',
      'general',
    ];
    const expected: Record<string, string> = {
      executive: 'executive.ceo',
      finance: 'finance.cfo',
      hr: 'people.hr',
      sales: 'growth.sales_manager',
      marketing: 'growth.marketing_manager',
      product: 'product.product_manager',
      legal: 'legal.compliance_manager',
      operations: 'operations.manager',
      customer_success: 'customersuccess.support_manager',
      procurement: 'procurement.vendor_manager',
      general: 'technology.developer',
    };
    for (const type of types) {
      const resolver = buildResolver('member', type);
      const role = await resolver.resolve({
        userId: 'usr_1',
        tenantId: 'org_1',
        workspaceId: 'ws_1',
      });
      expect(role).toBe(expected[type]);
    }
  });

  it('falls back to the default mapping when the `workspaces` dependency is omitted', async () => {
    const resolver = new MembershipBusinessRoleResolver({
      memberships: { findByOrganizationAndUser: async () => undefined } as never,
      workspaceMemberships: {
        findByWorkspaceAndUser: async () => ({ role: 'owner' }) as never,
      } as never,
    });
    const role = await resolver.resolve({
      userId: 'usr_1',
      tenantId: 'org_1',
      workspaceId: 'ws_1',
    });
    expect(role).toBe('executive.ceo');
  });

  it('returns undefined when the caller has no membership in the workspace', async () => {
    const resolver = new MembershipBusinessRoleResolver({
      memberships: { findByOrganizationAndUser: async () => undefined } as never,
      workspaceMemberships: { findByWorkspaceAndUser: async () => undefined } as never,
      workspaces: { findById: async () => fakeWorkspace('finance') } as never,
    });
    const role = await resolver.resolve({
      userId: 'usr_1',
      tenantId: 'org_1',
      workspaceId: 'ws_1',
    });
    expect(role).toBeUndefined();
  });
});
