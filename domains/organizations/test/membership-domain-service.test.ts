/**
 * MembershipDomainService tests: add/remove/change-role with organization
 * status gating and the last-owner rule.
 */

import { describe, expect, it } from 'vitest';
import type { UserId } from '@nexora/contracts/common';

import { ORGANIZATION_EVENT_TYPES, type MemberRemovedPayload } from '../src/events/index.js';
import {
  InvalidOrganizationValueError,
  LastOwnerRemovalError,
  MemberAlreadyExistsError,
  MemberNotFoundError,
  OrganizationArchivedError,
  OrganizationNotFoundError,
  OrganizationNotActiveError,
} from '../src/errors/index.js';
import { MembershipDomainService, OrganizationDomainService } from '../src/services/index.js';
import type { Organization } from '../src/entities/organization.js';
import {
  InMemoryMembershipRepository,
  InMemoryOrganizationRepository,
  testContext,
} from './helpers.js';

const context = testContext();
const USER_ID = 'usr_1' as UserId;
const OTHER_USER_ID = 'usr_2' as UserId;

interface Environment {
  service: MembershipDomainService;
  orgService: OrganizationDomainService;
  organizations: InMemoryOrganizationRepository;
  memberships: InMemoryMembershipRepository;
}

function makeService(): Environment {
  const organizations = new InMemoryOrganizationRepository();
  const memberships = new InMemoryMembershipRepository();
  const orgService = new OrganizationDomainService({ organizations });
  const service = new MembershipDomainService({ memberships, organizations });
  return { service, orgService, organizations, memberships };
}

async function createActiveOrganization(environment: Environment): Promise<Organization> {
  const created = await environment.orgService.create(
    { slug: 'acme', name: 'Acme Corp', type: 'enterprise' },
    context,
  );
  if (!created.ok) {
    throw new Error('setup failed');
  }
  const activated = await environment.orgService.activate(created.value.organization.id, context);
  if (!activated.ok) {
    throw new Error('setup failed');
  }
  return activated.value.organization;
}

async function createArchivedOrganization(environment: Environment): Promise<Organization> {
  const organization = await createActiveOrganization(environment);
  const archived = await environment.orgService.archive(organization.id, 'closed', context);
  if (!archived.ok) {
    throw new Error('setup failed');
  }
  return archived.value.organization;
}

describe('MembershipDomainService.addMember', () => {
  it('adds a member and emits MemberAdded', async () => {
    const environment = makeService();
    const organization = await createActiveOrganization(environment);
    const result = await environment.service.addMember(organization.id, USER_ID, 'admin', context);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.membership.userId).toBe(USER_ID);
      expect(result.value.membership.role).toBe('admin');
      expect(result.value.events.map((event) => event.type)).toContain(
        ORGANIZATION_EVENT_TYPES.memberAdded,
      );
    }
  });

  it('rejects a duplicate member', async () => {
    const environment = makeService();
    const organization = await createActiveOrganization(environment);
    await environment.service.addMember(organization.id, USER_ID, 'member', context);
    const result = await environment.service.addMember(organization.id, USER_ID, 'member', context);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBeInstanceOf(MemberAlreadyExistsError);
    }
  });

  it('rejects adding a member to a suspended organization', async () => {
    const environment = makeService();
    const organization = await createActiveOrganization(environment);
    await environment.orgService.suspend(organization.id, 'non-payment', context);
    const result = await environment.service.addMember(organization.id, USER_ID, 'member', context);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBeInstanceOf(OrganizationNotActiveError);
    }
  });

  it('rejects adding a member to a provisioning organization', async () => {
    const environment = makeService();
    const created = await environment.orgService.create(
      { slug: 'acme', name: 'Acme Corp', type: 'enterprise' },
      context,
    );
    if (!created.ok) {
      throw new Error('setup failed');
    }
    const result = await environment.service.addMember(
      created.value.organization.id,
      USER_ID,
      'member',
      context,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBeInstanceOf(OrganizationNotActiveError);
    }
  });

  it('rejects adding a member to an archived organization', async () => {
    const environment = makeService();
    const organization = await createArchivedOrganization(environment);
    const result = await environment.service.addMember(organization.id, USER_ID, 'member', context);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBeInstanceOf(OrganizationArchivedError);
    }
  });

  it('rejects an unknown organization', async () => {
    const environment = makeService();
    const result = await environment.service.addMember(
      'org_missing' as never,
      USER_ID,
      'member',
      context,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBeInstanceOf(OrganizationNotFoundError);
    }
  });

  it('rejects an invalid role before touching the organization', async () => {
    const environment = makeService();
    const result = await environment.service.addMember(
      'org_missing' as never,
      USER_ID,
      'superadmin' as never,
      context,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBeInstanceOf(InvalidOrganizationValueError);
    }
  });
});

describe('MembershipDomainService.removeMember', () => {
  it('removes a member and emits MemberRemoved with the held role', async () => {
    const environment = makeService();
    const organization = await createActiveOrganization(environment);
    await environment.service.addMember(organization.id, USER_ID, 'admin', context);
    const result = await environment.service.removeMember(organization.id, USER_ID, context);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.events.map((event) => event.type)).toContain(
        ORGANIZATION_EVENT_TYPES.memberRemoved,
      );
      const removed = result.value.events.find(
        (event) => event.type === ORGANIZATION_EVENT_TYPES.memberRemoved,
      );
      expect((removed?.payload as MemberRemovedPayload | undefined)?.role).toBe('admin');
    }
  });

  it('persists the removal (membership no longer listed)', async () => {
    const environment = makeService();
    const organization = await createActiveOrganization(environment);
    await environment.service.addMember(organization.id, USER_ID, 'member', context);
    await environment.service.removeMember(organization.id, USER_ID, context);
    const listed = await environment.memberships.listByOrganization(organization.id);
    expect(listed).toHaveLength(0);
  });

  it('returns MemberNotFoundError for a non-member', async () => {
    const environment = makeService();
    const organization = await createActiveOrganization(environment);
    const result = await environment.service.removeMember(organization.id, USER_ID, context);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBeInstanceOf(MemberNotFoundError);
    }
  });

  it('rejects removing a member from an archived organization', async () => {
    const environment = makeService();
    const organization = await createActiveOrganization(environment);
    await environment.service.addMember(organization.id, USER_ID, 'member', context);
    await environment.orgService.archive(organization.id, 'closed', context);
    const result = await environment.service.removeMember(organization.id, USER_ID, context);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBeInstanceOf(OrganizationArchivedError);
    }
  });

  it('rejects removing the last owner', async () => {
    const environment = makeService();
    const organization = await createActiveOrganization(environment);
    await environment.service.addMember(organization.id, USER_ID, 'owner', context);
    const result = await environment.service.removeMember(organization.id, USER_ID, context);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBeInstanceOf(LastOwnerRemovalError);
    }
  });

  it('allows removing an owner when another owner remains', async () => {
    const environment = makeService();
    const organization = await createActiveOrganization(environment);
    await environment.service.addMember(organization.id, USER_ID, 'owner', context);
    await environment.service.addMember(organization.id, OTHER_USER_ID, 'owner', context);
    const result = await environment.service.removeMember(organization.id, USER_ID, context);
    expect(result.ok).toBe(true);
  });

  it('allows removing a non-owner without the last-owner check', async () => {
    const environment = makeService();
    const organization = await createActiveOrganization(environment);
    await environment.service.addMember(organization.id, USER_ID, 'owner', context);
    await environment.service.addMember(organization.id, OTHER_USER_ID, 'member', context);
    const result = await environment.service.removeMember(organization.id, OTHER_USER_ID, context);
    expect(result.ok).toBe(true);
  });

  it('returns OrganizationNotFoundError for an unknown organization', async () => {
    const environment = makeService();
    const result = await environment.service.removeMember('org_missing' as never, USER_ID, context);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBeInstanceOf(OrganizationNotFoundError);
    }
  });
});

describe('MembershipDomainService.changeRole', () => {
  it('changes a member role', async () => {
    const environment = makeService();
    const organization = await createActiveOrganization(environment);
    await environment.service.addMember(organization.id, USER_ID, 'member', context);
    const result = await environment.service.changeRole(organization.id, USER_ID, 'admin', context);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.membership.role).toBe('admin');
      expect(result.value.events).toHaveLength(0);
    }
  });

  it('rejects demoting the last owner', async () => {
    const environment = makeService();
    const organization = await createActiveOrganization(environment);
    await environment.service.addMember(organization.id, USER_ID, 'owner', context);
    const result = await environment.service.changeRole(
      organization.id,
      USER_ID,
      'member',
      context,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBeInstanceOf(LastOwnerRemovalError);
    }
  });

  it('allows demoting an owner when another owner remains', async () => {
    const environment = makeService();
    const organization = await createActiveOrganization(environment);
    await environment.service.addMember(organization.id, USER_ID, 'owner', context);
    await environment.service.addMember(organization.id, OTHER_USER_ID, 'owner', context);
    const result = await environment.service.changeRole(
      organization.id,
      USER_ID,
      'member',
      context,
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.membership.role).toBe('member');
    }
  });

  it('allows promoting a member to owner', async () => {
    const environment = makeService();
    const organization = await createActiveOrganization(environment);
    await environment.service.addMember(organization.id, USER_ID, 'owner', context);
    await environment.service.addMember(organization.id, OTHER_USER_ID, 'member', context);
    const result = await environment.service.changeRole(
      organization.id,
      OTHER_USER_ID,
      'owner',
      context,
    );
    expect(result.ok).toBe(true);
  });

  it('returns MemberNotFoundError for a non-member', async () => {
    const environment = makeService();
    const organization = await createActiveOrganization(environment);
    const result = await environment.service.changeRole(organization.id, USER_ID, 'admin', context);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBeInstanceOf(MemberNotFoundError);
    }
  });

  it('rejects role changes in an archived organization', async () => {
    const environment = makeService();
    const organization = await createActiveOrganization(environment);
    await environment.service.addMember(organization.id, USER_ID, 'member', context);
    await environment.orgService.archive(organization.id, 'closed', context);
    const result = await environment.service.changeRole(organization.id, USER_ID, 'admin', context);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBeInstanceOf(OrganizationArchivedError);
    }
  });

  it('rejects an invalid role', async () => {
    const environment = makeService();
    const organization = await createActiveOrganization(environment);
    await environment.service.addMember(organization.id, USER_ID, 'member', context);
    const result = await environment.service.changeRole(
      organization.id,
      USER_ID,
      'superadmin' as never,
      context,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBeInstanceOf(InvalidOrganizationValueError);
    }
  });
});

describe('MembershipDomainService.listByOrganization', () => {
  it('lists the members of an organization', async () => {
    const environment = makeService();
    const organization = await createActiveOrganization(environment);
    await environment.service.addMember(organization.id, USER_ID, 'owner', context);
    await environment.service.addMember(organization.id, OTHER_USER_ID, 'member', context);
    const result = await environment.service.listByOrganization(organization.id);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toHaveLength(2);
    }
  });

  it('returns an empty list for an organization without members', async () => {
    const environment = makeService();
    const organization = await createActiveOrganization(environment);
    const result = await environment.service.listByOrganization(organization.id);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toHaveLength(0);
    }
  });

  it('returns OrganizationNotFoundError for an unknown organization', async () => {
    const environment = makeService();
    const result = await environment.service.listByOrganization('org_missing' as never);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBeInstanceOf(OrganizationNotFoundError);
    }
  });
});
