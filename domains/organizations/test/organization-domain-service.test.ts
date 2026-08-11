/**
 * OrganizationDomainService tests: creation (slug uniqueness), activation,
 * suspension, archival, settings and profile updates, and queries.
 */

import { describe, expect, it } from 'vitest';

import {
  ORGANIZATION_EVENT_TYPES,
  type OrganizationSettingsUpdatedPayload,
} from '../src/events/index.js';
import {
  InvalidOrganizationValueError,
  OrganizationArchivedError,
  OrganizationNotFoundError,
  OrganizationStateTransitionError,
  SlugAlreadyExistsError,
} from '../src/errors/index.js';
import { OrganizationDomainService } from '../src/services/index.js';
import type { Organization } from '../src/entities/organization.js';
import { InMemoryOrganizationRepository, testContext } from './helpers.js';

const context = testContext();

interface Environment {
  service: OrganizationDomainService;
  organizations: InMemoryOrganizationRepository;
}

function makeService(): Environment {
  const organizations = new InMemoryOrganizationRepository();
  const service = new OrganizationDomainService({ organizations });
  return { service, organizations };
}

const createInput = {
  slug: 'acme',
  name: 'Acme Corp',
  type: 'enterprise',
};

async function createOrganization(service: OrganizationDomainService): Promise<Organization> {
  const result = await service.create(createInput, context);
  if (!result.ok) {
    throw new Error('setup failed');
  }
  return result.value.organization;
}

async function createActiveOrganization(service: OrganizationDomainService): Promise<Organization> {
  const organization = await createOrganization(service);
  const activated = await service.activate(organization.id, context);
  if (!activated.ok) {
    throw new Error('setup failed');
  }
  return activated.value.organization;
}

describe('OrganizationDomainService.create', () => {
  it('creates an organization in provisioning status and emits OrganizationCreated', async () => {
    const { service } = makeService();
    const result = await service.create(createInput, context);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.organization.status.value).toBe('provisioning');
      expect(result.value.events.map((event) => event.type)).toContain(
        ORGANIZATION_EVENT_TYPES.organizationCreated,
      );
    }
  });

  it('rejects a taken slug', async () => {
    const { service } = makeService();
    await createOrganization(service);
    const result = await service.create({ ...createInput, slug: 'acme' }, context);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBeInstanceOf(SlugAlreadyExistsError);
    }
  });

  it('allows a distinct slug', async () => {
    const { service } = makeService();
    await createOrganization(service);
    const result = await service.create({ ...createInput, slug: 'acme-eu' }, context);
    expect(result.ok).toBe(true);
  });

  it('rejects an invalid slug format', async () => {
    const { service } = makeService();
    const result = await service.create({ ...createInput, slug: 'Acme Corp' }, context);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBeInstanceOf(InvalidOrganizationValueError);
    }
  });

  it('rejects an invalid type', async () => {
    const { service } = makeService();
    const result = await service.create({ ...createInput, type: 'retail' }, context);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBeInstanceOf(InvalidOrganizationValueError);
    }
  });

  it('rejects an empty name', async () => {
    const { service } = makeService();
    const result = await service.create({ ...createInput, name: '   ' }, context);
    expect(result.ok).toBe(false);
  });

  it('honors an explicit initial status', async () => {
    const { service } = makeService();
    const result = await service.create({ ...createInput, status: 'active' }, context);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.organization.status.value).toBe('active');
    }
  });

  it('rejects an unknown initial status', async () => {
    const { service } = makeService();
    const result = await service.create({ ...createInput, status: 'deleted' }, context);
    expect(result.ok).toBe(false);
  });

  it('persists the organization', async () => {
    const { service, organizations } = makeService();
    const created = await createOrganization(service);
    expect(await organizations.findById(created.id)).toBeDefined();
  });
});

describe('OrganizationDomainService lifecycle', () => {
  it('activates a provisioning organization', async () => {
    const { service } = makeService();
    const organization = await createOrganization(service);
    const result = await service.activate(organization.id, context);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.organization.status.value).toBe('active');
      expect(result.value.events.map((event) => event.type)).toContain(
        ORGANIZATION_EVENT_TYPES.organizationActivated,
      );
    }
  });

  it('returns OrganizationNotFoundError for an unknown organization', async () => {
    const { service } = makeService();
    const result = await service.activate('org_missing' as never, context);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBeInstanceOf(OrganizationNotFoundError);
    }
  });

  it('rejects activating an already-active organization', async () => {
    const { service } = makeService();
    const organization = await createActiveOrganization(service);
    const result = await service.activate(organization.id, context);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBeInstanceOf(OrganizationStateTransitionError);
    }
  });

  it('suspends an active organization', async () => {
    const { service } = makeService();
    const organization = await createActiveOrganization(service);
    const result = await service.suspend(organization.id, 'non-payment', context);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.organization.status.value).toBe('suspended');
      expect(result.value.events.map((event) => event.type)).toContain(
        ORGANIZATION_EVENT_TYPES.organizationSuspended,
      );
    }
  });

  it('rejects suspending a provisioning organization', async () => {
    const { service } = makeService();
    const organization = await createOrganization(service);
    const result = await service.suspend(organization.id, 'x', context);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBeInstanceOf(OrganizationStateTransitionError);
    }
  });

  it('archives an active organization', async () => {
    const { service } = makeService();
    const organization = await createActiveOrganization(service);
    const result = await service.archive(organization.id, 'closed', context);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.organization.status.value).toBe('archived');
      expect(result.value.events.map((event) => event.type)).toContain(
        ORGANIZATION_EVENT_TYPES.organizationArchived,
      );
    }
  });

  it('archives a suspended organization', async () => {
    const { service } = makeService();
    const organization = await createActiveOrganization(service);
    await service.suspend(organization.id, 'non-payment', context);
    const result = await service.archive(organization.id, 'closed', context);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.organization.status.value).toBe('archived');
    }
  });

  it('rejects archiving a provisioning organization', async () => {
    const { service } = makeService();
    const organization = await createOrganization(service);
    const result = await service.archive(organization.id, 'x', context);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBeInstanceOf(OrganizationStateTransitionError);
    }
  });

  it('rejects archiving an already-archived organization', async () => {
    const { service } = makeService();
    const organization = await createActiveOrganization(service);
    await service.archive(organization.id, 'closed', context);
    const result = await service.archive(organization.id, 'again', context);
    expect(result.ok).toBe(false);
  });
});

describe('OrganizationDomainService settings & profile', () => {
  it('updates settings and reports changed fields', async () => {
    const { service } = makeService();
    const organization = await createActiveOrganization(service);
    const result = await service.updateSettings(
      organization.id,
      { defaultLocale: 'de-DE', retentionDays: 90 },
      context,
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.organization.settings.defaultLocale).toBe('de-DE');
      const settingsEvent = result.value.events.find(
        (event) => event.type === ORGANIZATION_EVENT_TYPES.organizationSettingsUpdated,
      );
      expect(
        (settingsEvent?.payload as OrganizationSettingsUpdatedPayload | undefined)?.changedFields,
      ).toEqual(['defaultLocale', 'retentionDays']);
    }
  });

  it('rejects settings updates on an archived organization', async () => {
    const { service } = makeService();
    const organization = await createActiveOrganization(service);
    await service.archive(organization.id, 'closed', context);
    const result = await service.updateSettings(organization.id, { aiEnabled: false }, context);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBeInstanceOf(OrganizationArchivedError);
    }
  });

  it('rejects invalid settings values', async () => {
    const { service } = makeService();
    const organization = await createActiveOrganization(service);
    const result = await service.updateSettings(organization.id, { retentionDays: 1 }, context);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBeInstanceOf(InvalidOrganizationValueError);
    }
  });

  it('rejects settings updates for an unknown organization', async () => {
    const { service } = makeService();
    const result = await service.updateSettings(
      'org_missing' as never,
      { aiEnabled: false },
      context,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBeInstanceOf(OrganizationNotFoundError);
    }
  });

  it('updates the profile', async () => {
    const { service } = makeService();
    const organization = await createActiveOrganization(service);
    const result = await service.updateProfile(organization.id, { name: 'Acme Holdings' });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.organization.profile.name.value).toBe('Acme Holdings');
    }
  });

  it('rejects profile updates on an archived organization', async () => {
    const { service } = makeService();
    const organization = await createActiveOrganization(service);
    await service.archive(organization.id, 'closed', context);
    const result = await service.updateProfile(organization.id, { name: 'X' });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBeInstanceOf(OrganizationArchivedError);
    }
  });

  it('rejects an invalid profile update', async () => {
    const { service } = makeService();
    const organization = await createActiveOrganization(service);
    const result = await service.updateProfile(organization.id, { name: '' });
    expect(result.ok).toBe(false);
  });
});

describe('OrganizationDomainService queries', () => {
  it('finds an organization by id', async () => {
    const { service } = makeService();
    const organization = await createOrganization(service);
    const result = await service.findById(organization.id);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.id).toBe(organization.id);
    }
  });

  it('returns OrganizationNotFoundError for an unknown id', async () => {
    const { service } = makeService();
    const result = await service.findById('org_missing' as never);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBeInstanceOf(OrganizationNotFoundError);
    }
  });

  it('finds an organization by slug', async () => {
    const { service } = makeService();
    const organization = await createOrganization(service);
    const result = await service.findBySlug('acme');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.id).toBe(organization.id);
    }
  });

  it('returns OrganizationNotFoundError for an unknown slug', async () => {
    const { service } = makeService();
    const result = await service.findBySlug('nope');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBeInstanceOf(OrganizationNotFoundError);
    }
  });

  it('rejects an invalid slug in a query', async () => {
    const { service } = makeService();
    const result = await service.findBySlug('Nope Corp');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBeInstanceOf(InvalidOrganizationValueError);
    }
  });
});
