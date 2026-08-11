/**
 * ListOrganizations query tests: the user → organizations read model.
 */

import { describe, expect, it } from 'vitest';
import type { UserId } from '@nexora/contracts/common';
import type { Organization, OrganizationId } from '@nexora/domain-organizations';
import { MembershipDomainService, OrganizationDomainService } from '@nexora/domain-organizations';

import { OrganizationApplicationService } from '../src/services/organization-application-service.js';
import { ListOrganizationsHandler } from '../src/query-handlers/list-organizations.handler.js';
import {
  InMemoryMembershipRepository,
  InMemoryOrganizationRepository,
  RecordingEventPublisher,
} from './helpers.js';

/** Counts lookups so tests can assert batching (no N+1). */
class CountingOrganizationRepository extends InMemoryOrganizationRepository {
  findByIdCalls = 0;
  listByIdsCalls = 0;

  override async findById(id: OrganizationId): Promise<Organization | undefined> {
    this.findByIdCalls += 1;
    return super.findById(id);
  }

  override async listByIds(ids: readonly OrganizationId[]): Promise<readonly Organization[]> {
    this.listByIdsCalls += 1;
    return super.listByIds(ids);
  }
}

const ALICE = 'usr_alice' as UserId;
const BOB = 'usr_bob' as UserId;

async function makeSeededEnvironment() {
  const organizations = new InMemoryOrganizationRepository();
  const memberships = new InMemoryMembershipRepository();
  const publisher = new RecordingEventPublisher();

  const organizationsService = new OrganizationDomainService({ organizations });
  const membershipsService = new MembershipDomainService({ memberships, organizations });
  const service = new OrganizationApplicationService({
    organizationsService,
    membershipsService,
    membershipsRepository: memberships,
    publisher,
  });

  // Seed: alice owns two orgs, bob one.
  for (const [name, slug, owner] of [
    ['Acme Inc.', 'acme', ALICE],
    ['Beta LLC', 'beta', ALICE],
    ['Gamma Co', 'gamma', BOB],
  ] as const) {
    const created = await service.createOrganization({
      name,
      slug,
      type: 'startup',
      actorId: owner,
      correlationId: 'corr_seed',
    });
    if (!created.ok) {
      throw new Error('seed failed');
    }
  }
  return { service, handler: new ListOrganizationsHandler(service) };
}

describe('ListOrganizationsHandler', () => {
  it('lists the organizations a user belongs to', async () => {
    const { handler } = await makeSeededEnvironment();
    const result = await handler.handle({ userId: ALICE });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.map((org) => org.slug).sort()).toEqual(['acme', 'beta']);
    }
  });

  it('returns an empty list for a user with no memberships', async () => {
    const { handler } = await makeSeededEnvironment();
    const result = await handler.handle({ userId: 'usr_ghost' as UserId });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual([]);
    }
  });

  it('returns DTOs with stable public fields', async () => {
    const { handler } = await makeSeededEnvironment();
    const result = await handler.handle({ userId: BOB });
    expect(result.ok).toBe(true);
    if (result.ok) {
      const org = result.value[0];
      if (org === undefined) {
        throw new Error('expected an org');
      }
      expect(org).toMatchObject({
        slug: 'gamma',
        name: 'Gamma Co',
        type: 'startup',
        status: 'active',
      });
      expect(org.id).toMatch(/^org_/);
      expect(typeof org.createdAt).toBe('string');
    }
  });

  it('resolves memberships with a single batched query (no N+1)', async () => {
    const organizations = new CountingOrganizationRepository();
    const memberships = new InMemoryMembershipRepository();
    const publisher = new RecordingEventPublisher();
    const organizationsService = new OrganizationDomainService({ organizations });
    const membershipsService = new MembershipDomainService({ memberships, organizations });
    const service = new OrganizationApplicationService({
      organizationsService,
      membershipsService,
      membershipsRepository: memberships,
      publisher,
    });

    for (const [name, slug] of [
      ['Acme Inc.', 'acme'],
      ['Beta LLC', 'beta'],
      ['Gamma Co', 'gamma'],
    ] as const) {
      const created = await service.createOrganization({
        name,
        slug,
        type: 'startup',
        actorId: ALICE,
        correlationId: 'corr_seed',
      });
      if (!created.ok) {
        throw new Error('seed failed');
      }
    }
    // Reset counters: seeding itself uses findById (create→activate→join).
    organizations.findByIdCalls = 0;
    organizations.listByIdsCalls = 0;

    const result = await service.listOrganizationsByUser(ALICE);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toHaveLength(3);
    }
    // Three memberships resolved with one batched lookup, not three singles.
    expect(organizations.listByIdsCalls).toBe(1);
    expect(organizations.findByIdCalls).toBe(0);
  });
});
