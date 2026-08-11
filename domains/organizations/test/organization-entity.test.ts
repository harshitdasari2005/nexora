/**
 * Organization aggregate tests: creation, lifecycle transitions, settings and
 * profile updates, invariants, and event emission.
 */

import { describe, expect, it } from 'vitest';

import {
  ORGANIZATION_EVENT_TYPES,
  type OrganizationCreatedPayload,
  type OrganizationSettingsUpdatedPayload,
  type OrganizationSuspendedPayload,
} from '../src/events/index.js';
import { OrganizationStateTransitionError } from '../src/errors/index.js';
import { Organization } from '../src/entities/organization.js';
import { OrganizationSlug } from '../src/value-objects/organization-slug.js';
import { OrganizationStatus } from '../src/value-objects/organization-status.js';
import { OrganizationType } from '../src/value-objects/organization-type.js';
import { InvalidOrganizationValueError } from '../src/errors/index.js';
import { testContext } from './helpers.js';

const context = testContext();

function createOrganization(
  overrides: Partial<Parameters<typeof Organization.create>[0]> = {},
): Organization {
  return Organization.create(
    {
      slug: OrganizationSlug.create('acme'),
      name: 'Acme Corp',
      type: OrganizationType.enterprise(),
      ...overrides,
    },
    context,
  );
}

describe('Organization aggregate', () => {
  it('creates in provisioning status and emits OrganizationCreated', () => {
    const organization = createOrganization();
    expect(organization.id).toMatch(/^org_/);
    expect(organization.status.value).toBe('provisioning');
    expect(organization.isActive()).toBe(false);
    const events = organization.pullDomainEvents();
    expect(events).toHaveLength(1);
    expect(events[0]?.type).toBe(ORGANIZATION_EVENT_TYPES.organizationCreated);
    if (events[0]) {
      expect((events[0].payload as OrganizationCreatedPayload).slug).toBe('acme');
      expect((events[0].payload as OrganizationCreatedPayload).status).toBe('provisioning');
    }
  });

  it('honors an explicit initial status', () => {
    const organization = createOrganization({ status: OrganizationStatus.active() });
    expect(organization.status.value).toBe('active');
  });

  it('exposes the tenant id (same identifier as the organization id)', () => {
    const organization = createOrganization();
    expect(organization.tenantId).toBe(organization.id);
  });

  it('exposes slug, type, profile, and settings', () => {
    const organization = createOrganization({
      name: 'Acme Corp',
      description: 'Software company',
    });
    expect(organization.slug.value).toBe('acme');
    expect(organization.type.value).toBe('enterprise');
    expect(organization.profile.name.value).toBe('Acme Corp');
    expect(organization.profile.description).toBe('Software company');
    expect(organization.settings.retentionDays).toBe(365);
    expect(organization.settings.aiEnabled).toBe(true);
  });

  it('activates a provisioning organization and emits OrganizationActivated', () => {
    const organization = createOrganization();
    organization.activate(context);
    expect(organization.status.value).toBe('active');
    expect(organization.isActive()).toBe(true);
    const events = organization.pullDomainEvents();
    expect(events.map((event) => event.type)).toContain(
      ORGANIZATION_EVENT_TYPES.organizationActivated,
    );
  });

  it('rejects activating an already-active organization', () => {
    const organization = createOrganization({ status: OrganizationStatus.active() });
    expect(() => organization.activate(context)).toThrow(OrganizationStateTransitionError);
  });

  it('rejects activating an archived organization', () => {
    const organization = createOrganization({ status: OrganizationStatus.archived() });
    expect(() => organization.activate(context)).toThrow(OrganizationStateTransitionError);
  });

  it('suspends an active organization and emits OrganizationSuspended', () => {
    const organization = createOrganization({ status: OrganizationStatus.active() });
    organization.suspend('non-payment', context);
    expect(organization.status.value).toBe('suspended');
    const events = organization.pullDomainEvents();
    const suspended = events.find(
      (event) => event.type === ORGANIZATION_EVENT_TYPES.organizationSuspended,
    );
    expect((suspended?.payload as OrganizationSuspendedPayload | undefined)?.reason).toBe(
      'non-payment',
    );
  });

  it('rejects suspending a provisioning organization', () => {
    const organization = createOrganization();
    expect(() => organization.suspend('x', context)).toThrow(OrganizationStateTransitionError);
  });

  it('archives an active organization and emits OrganizationArchived', () => {
    const organization = createOrganization({ status: OrganizationStatus.active() });
    organization.archive('closed', context);
    expect(organization.status.value).toBe('archived');
    const events = organization.pullDomainEvents();
    expect(events.map((event) => event.type)).toContain(
      ORGANIZATION_EVENT_TYPES.organizationArchived,
    );
  });

  it('archives a suspended organization', () => {
    const organization = createOrganization({ status: OrganizationStatus.suspended() });
    organization.archive('closed', context);
    expect(organization.status.value).toBe('archived');
  });

  it('rejects archiving a provisioning organization', () => {
    const organization = createOrganization();
    expect(() => organization.archive('x', context)).toThrow(OrganizationStateTransitionError);
  });

  it('rejects archiving an already-archived organization', () => {
    const organization = createOrganization({ status: OrganizationStatus.archived() });
    expect(() => organization.archive('x', context)).toThrow(OrganizationStateTransitionError);
  });

  it('reactivates a suspended organization (suspended → active)', () => {
    const organization = createOrganization({ status: OrganizationStatus.suspended() });
    organization.activate(context);
    expect(organization.status.value).toBe('active');
  });

  it('updates settings and emits OrganizationSettingsUpdated with changed keys', () => {
    const organization = createOrganization({ status: OrganizationStatus.active() });
    organization.updateSettings(
      { defaultLocale: 'de-DE', retentionDays: 90, aiEnabled: false },
      context,
    );
    expect(organization.settings.defaultLocale).toBe('de-DE');
    expect(organization.settings.retentionDays).toBe(90);
    expect(organization.settings.aiEnabled).toBe(false);
    const events = organization.pullDomainEvents();
    const settingsEvent = events.find(
      (event) => event.type === ORGANIZATION_EVENT_TYPES.organizationSettingsUpdated,
    );
    expect(
      (settingsEvent?.payload as OrganizationSettingsUpdatedPayload | undefined)?.changedFields,
    ).toEqual(['defaultLocale', 'retentionDays', 'aiEnabled']);
  });

  it('emits no settings event when nothing changed', () => {
    const organization = createOrganization({ status: OrganizationStatus.active() });
    organization.pullDomainEvents();
    organization.updateSettings({}, context);
    expect(organization.pullDomainEvents()).toHaveLength(0);
  });

  it('rejects invalid settings values', () => {
    const organization = createOrganization({ status: OrganizationStatus.active() });
    expect(() => organization.updateSettings({ retentionDays: 1 }, context)).toThrow(
      InvalidOrganizationValueError,
    );
    expect(() => organization.updateSettings({ defaultLocale: 'en-US-extra' }, context)).toThrow(
      InvalidOrganizationValueError,
    );
    expect(() => organization.updateSettings({ dataResidency: 'eu-west-1' }, context)).toThrow(
      InvalidOrganizationValueError,
    );
  });

  it('a rejected settings update leaves the settings unchanged', () => {
    const organization = createOrganization({ status: OrganizationStatus.active() });
    const version = organization.version;
    organization.pullDomainEvents();
    expect(() =>
      organization.updateSettings({ defaultLocale: 'de-DE', retentionDays: 1 }, context),
    ).toThrow(InvalidOrganizationValueError);
    // No partial writes: the valid field was not applied, version not bumped.
    expect(organization.settings.defaultLocale).toBe('en');
    expect(organization.settings.retentionDays).toBe(365);
    expect(organization.version).toBe(version);
    expect(organization.pullDomainEvents()).toHaveLength(0);
  });

  it('updates the profile', () => {
    const organization = createOrganization({ status: OrganizationStatus.active() });
    organization.updateProfile({
      name: 'Acme Holdings',
      description: 'Group',
      website: 'https://acme.example',
    });
    expect(organization.profile.name.value).toBe('Acme Holdings');
    expect(organization.profile.description).toBe('Group');
  });

  it('rejects an invalid profile update', () => {
    const organization = createOrganization({ status: OrganizationStatus.active() });
    expect(() => organization.updateProfile({ name: '' })).toThrow(InvalidOrganizationValueError);
    expect(() => organization.updateProfile({ contactEmail: 'not-an-email' })).toThrow(
      InvalidOrganizationValueError,
    );
  });

  it('a rejected profile update leaves the profile unchanged', () => {
    const organization = createOrganization({ status: OrganizationStatus.active() });
    const version = organization.version;
    expect(() =>
      organization.updateProfile({ name: 'Acme Holdings', contactEmail: 'not-an-email' }),
    ).toThrow(InvalidOrganizationValueError);
    expect(organization.profile.name.value).toBe('Acme Corp');
    expect(organization.profile.contactEmail).toBeUndefined();
    expect(organization.version).toBe(version);
  });

  it('bumps the version on every mutation', () => {
    const organization = createOrganization({ status: OrganizationStatus.active() });
    const initial = organization.version;
    organization.updateSettings({ defaultLocale: 'fr' }, context);
    expect(organization.version).toBe(initial + 1);
    organization.updateProfile({ name: 'Acme France' });
    expect(organization.version).toBe(initial + 2);
  });

  it('does not bump the version when an update changes nothing', () => {
    const organization = createOrganization({ status: OrganizationStatus.active() });
    const version = organization.version;
    organization.updateSettings({}, context);
    expect(organization.version).toBe(version);
    organization.updateProfile({});
    expect(organization.version).toBe(version);
  });

  it('pullDomainEvents clears the queue', () => {
    const organization = createOrganization();
    organization.pullDomainEvents();
    organization.activate(context);
    expect(organization.pullDomainEvents().length).toBeGreaterThan(0);
    expect(organization.pullDomainEvents()).toHaveLength(0);
  });
});
