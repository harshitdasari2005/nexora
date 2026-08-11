/**
 * OrganizationMembership aggregate tests: creation, role changes, invariants,
 * and event emission.
 */

import { describe, expect, it } from 'vitest';
import type { UserId } from '@nexora/contracts/common';

import { ORGANIZATION_EVENT_TYPES, type MemberAddedPayload } from '../src/events/index.js';
import { InvalidOrganizationValueError } from '../src/errors/index.js';
import type { MEMBERSHIP_ROLES } from '../src/entities/organization-membership.js';
import { OrganizationMembership } from '../src/entities/organization-membership.js';
import { OrganizationId } from '../src/value-objects/organization-id.js';
import { testContext } from './helpers.js';

const context = testContext();
const organizationId = OrganizationId.create();
const USER_ID = 'usr_1' as UserId;

function createMembership(
  role: (typeof MEMBERSHIP_ROLES)[number] = 'member',
): OrganizationMembership {
  return OrganizationMembership.create({ organizationId, userId: USER_ID, role }, context);
}

describe('OrganizationMembership aggregate', () => {
  it('creates and emits MemberAdded', () => {
    const membership = createMembership('admin');
    expect(membership.id).toMatch(/^mbr_/);
    expect(membership.organizationId).toBe(organizationId);
    expect(membership.userId).toBe(USER_ID);
    expect(membership.role).toBe('admin');
    const events = membership.pullDomainEvents();
    expect(events).toHaveLength(1);
    expect(events[0]?.type).toBe(ORGANIZATION_EVENT_TYPES.memberAdded);
    if (events[0]) {
      expect((events[0].payload as MemberAddedPayload).role).toBe('admin');
      expect((events[0].payload as MemberAddedPayload).userId).toBe(USER_ID);
    }
  });

  it('rejects an unknown role at creation', () => {
    expect(() =>
      OrganizationMembership.create(
        { organizationId, userId: USER_ID, role: 'superadmin' as never },
        context,
      ),
    ).toThrow(InvalidOrganizationValueError);
  });

  it('isOwner reflects the role', () => {
    expect(createMembership('owner').isOwner()).toBe(true);
    expect(createMembership('admin').isOwner()).toBe(false);
    expect(createMembership('member').isOwner()).toBe(false);
  });

  it('changes the role and bumps the version', () => {
    const membership = createMembership('member');
    const version = membership.version;
    const changed = membership.changeRole('admin');
    expect(changed).toBe(true);
    expect(membership.role).toBe('admin');
    expect(membership.version).toBe(version + 1);
  });

  it('treats a change to the same role as a no-op', () => {
    const membership = createMembership('owner');
    const version = membership.version;
    expect(membership.changeRole('owner')).toBe(false);
    expect(membership.version).toBe(version);
  });

  it('rejects an unknown role on change', () => {
    const membership = createMembership('member');
    expect(() => membership.changeRole('owner-extra' as never)).toThrow(
      InvalidOrganizationValueError,
    );
  });

  it('emits no event on role change (documented v1 behavior)', () => {
    const membership = createMembership('member');
    membership.pullDomainEvents();
    membership.changeRole('admin');
    expect(membership.pullDomainEvents()).toHaveLength(0);
  });

  it('records the join time', () => {
    const membership = OrganizationMembership.create(
      { organizationId, userId: USER_ID, role: 'member' },
      context,
      '2026-01-01T00:00:00.000Z',
    );
    expect(membership.joinedAt).toBe('2026-01-01T00:00:00.000Z');
  });
});
