/**
 * Aggregate reconstitution tests: `snapshot()` → `hydrate()` round-trips must
 * restore exact identity, timestamps, version, and child state WITHOUT
 * emitting domain events (PERSISTENCE.md §4 reconstitution).
 */

import { describe, expect, it } from 'vitest';
import type { UserId } from '@nexora/contracts/common';
import { prefixedId } from '@nexora/shared/ids';

import { Organization } from '../src/entities/organization.js';
import { OrganizationMembership } from '../src/entities/organization-membership.js';
import { OrganizationSlug } from '../src/value-objects/organization-slug.js';
import { OrganizationType } from '../src/value-objects/organization-type.js';
import { OrganizationStatus } from '../src/value-objects/organization-status.js';
import { testContext } from './helpers.js';

const context = testContext();

function createOrganization() {
  return Organization.create(
    {
      slug: OrganizationSlug.create('acme'),
      name: 'Acme Inc',
      type: OrganizationType.enterprise(),
      description: 'A company',
      website: 'https://acme.example',
      contactEmail: 'hello@acme.example',
      status: OrganizationStatus.active(),
    },
    context,
  );
}

describe('Organization hydrate round-trip', () => {
  it('restores identity, profile, settings, and version without events', () => {
    const organization = createOrganization();
    organization.pullDomainEvents();
    organization.updateSettings({ retentionDays: 730, aiEnabled: false }, context);
    organization.pullDomainEvents();
    organization.updateProfile({ name: 'Acme Corp' });
    const before = organization.version;

    const hydrated = Organization.hydrate(Organization.snapshot(organization));
    expect(hydrated.id).toBe(organization.id);
    expect(hydrated.slug.value).toBe('acme');
    expect(hydrated.type.value).toBe('enterprise');
    expect(hydrated.status.value).toBe('active');
    expect(hydrated.profile.name.value).toBe('Acme Corp');
    expect(hydrated.profile.description).toBe('A company');
    expect(hydrated.profile.website).toBe('https://acme.example');
    expect(hydrated.settings.retentionDays).toBe(730);
    expect(hydrated.settings.aiEnabled).toBe(false);
    expect(hydrated.createdAt).toBe(organization.createdAt);
    expect(hydrated.updatedAt).toBe(organization.updatedAt);
    expect(hydrated.version).toBe(before);
    expect(hydrated.pullDomainEvents()).toHaveLength(0);
  });

  it('hydrated organizations remain mutable and policy-enforcing', () => {
    const organization = createOrganization();
    const hydrated = Organization.hydrate(Organization.snapshot(organization));
    hydrated.suspend('compliance', context);
    expect(hydrated.status.value).toBe('suspended');
    expect(() => hydrated.activate(context)).not.toThrow();
  });
});

describe('OrganizationMembership hydrate round-trip', () => {
  it('restores role, timestamps, and version', () => {
    const membership = OrganizationMembership.create(
      {
        organizationId: Organization.create(
          { slug: OrganizationSlug.create('acme'), name: 'Acme', type: OrganizationType.smb() },
          context,
        ).id,
        userId: prefixedId('usr') as UserId,
        role: 'owner',
      },
      context,
    );
    membership.changeRole('admin');
    const before = membership.version;

    const hydrated = OrganizationMembership.hydrate(OrganizationMembership.snapshot(membership));
    expect(hydrated.id).toBe(membership.id);
    expect(hydrated.organizationId).toBe(membership.organizationId);
    expect(hydrated.userId).toBe(membership.userId);
    expect(hydrated.role).toBe('admin');
    expect(hydrated.joinedAt).toBe(membership.joinedAt);
    expect(hydrated.version).toBe(before);
    expect(hydrated.pullDomainEvents()).toHaveLength(0);
  });

  it('rejects an invalid role in the snapshot', () => {
    const membership = OrganizationMembership.create(
      {
        organizationId: Organization.create(
          { slug: OrganizationSlug.create('acme'), name: 'Acme', type: OrganizationType.smb() },
          context,
        ).id,
        userId: prefixedId('usr') as UserId,
        role: 'member',
      },
      context,
    );
    const snapshot = OrganizationMembership.snapshot(membership);
    expect(() => OrganizationMembership.hydrate({ ...snapshot, role: 'boss' as never })).toThrow();
  });
});
