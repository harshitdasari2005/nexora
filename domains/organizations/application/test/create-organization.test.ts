/**
 * CreateOrganization use-case tests: provision (create → activate → owner)
 * flow, event publishing, and failure paths.
 */

import { describe, expect, it } from 'vitest';
import type { UserId } from '@nexora/contracts/common';
import { ValidationError } from '@nexora/shared/errors';

import {
  MembershipDomainService,
  OrganizationDomainService,
  ORGANIZATION_EVENT_TYPES,
  SlugAlreadyExistsError,
} from '@nexora/domain-organizations';

import type { CreateOrganizationCommand } from '../src/commands/create-organization.command.js';
import { OrganizationApplicationService } from '../src/services/organization-application-service.js';
import {
  InMemoryMembershipRepository,
  InMemoryOrganizationRepository,
  RecordingEventPublisher,
} from './helpers.js';

const ACTOR = 'usr_alex' as UserId;

function makeEnvironment() {
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
  return { service, organizations, memberships, publisher };
}

function command(overrides: Partial<CreateOrganizationCommand> = {}): CreateOrganizationCommand {
  return {
    name: 'Acme Inc.',
    slug: 'acme',
    type: 'startup',
    actorId: ACTOR,
    correlationId: 'corr_org_1',
    ...overrides,
  };
}

describe('OrganizationApplicationService.createOrganization', () => {
  it('provisions an active organization with the creator as first owner', async () => {
    const { service, organizations, memberships, publisher } = makeEnvironment();
    const result = await service.createOrganization(command());

    expect(result.ok).toBe(true);
    if (result.ok) {
      const org = organizations.organizations.get(result.value.organization.id);
      expect(org).toBeDefined();
      expect(org?.status.value).toBe('active');
      expect(org?.profile.name.value).toBe('Acme Inc.');
      const membership = memberships.memberships.get(result.value.membership.id);
      expect(membership?.userId).toBe(ACTOR);
      expect(membership?.role).toBe('owner');
    }
    expect(publisher.types).toEqual([
      ORGANIZATION_EVENT_TYPES.organizationCreated,
      ORGANIZATION_EVENT_TYPES.organizationActivated,
      ORGANIZATION_EVENT_TYPES.memberAdded,
    ]);
  });

  it('rejects a duplicate slug with SlugAlreadyExistsError', async () => {
    const { service } = makeEnvironment();
    const first = await service.createOrganization(command());
    expect(first.ok).toBe(true);

    const second = await service.createOrganization(command({ correlationId: 'corr_org_2' }));
    expect(second.ok).toBe(false);
    if (!second.ok) {
      expect(second.error).toBeInstanceOf(SlugAlreadyExistsError);
    }
  });

  it('rejects an unknown organization type', async () => {
    const { service } = makeEnvironment();
    const result = await service.createOrganization(command({ type: 'alien' }));
    // The command validator rejects unknown types before the domain runs.
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBeInstanceOf(ValidationError);
    }
  });

  it('rejects a malformed command with a ValidationError', async () => {
    const { service } = makeEnvironment();
    const result = await service.createOrganization(
      command({ slug: '!!bad slug!!', type: 'nope' }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBeInstanceOf(ValidationError);
    }
  });

  it('publishes nothing when provisioning fails midway', async () => {
    const { service, publisher } = makeEnvironment();
    const result = await service.createOrganization(command({ slug: '!!bad!!' }));
    expect(result.ok).toBe(false);
    expect(publisher.types).toHaveLength(0);
  });
});
