/**
 * Organization value object tests: OrganizationId, OrganizationName,
 * OrganizationSlug, OrganizationStatus, OrganizationType.
 */

import { describe, expect, it } from 'vitest';

import { InvalidOrganizationValueError } from '../src/errors/index.js';
import { OrganizationId } from '../src/value-objects/organization-id.js';
import {
  OrganizationName,
  MAX_ORGANIZATION_NAME_LENGTH,
} from '../src/value-objects/organization-name.js';
import {
  OrganizationSlug,
  MAX_SLUG_LENGTH,
  MIN_SLUG_LENGTH,
} from '../src/value-objects/organization-slug.js';
import {
  ORGANIZATION_STATUSES,
  OrganizationStatus,
} from '../src/value-objects/organization-status.js';
import { ORGANIZATION_TYPES, OrganizationType } from '../src/value-objects/organization-type.js';

describe('OrganizationId', () => {
  it('creates unique prefixed ids', () => {
    const first = OrganizationId.create();
    const second = OrganizationId.create();
    expect(first).toMatch(/^org_/);
    expect(first).not.toBe(second);
  });

  it('reconstructs a stored id', () => {
    const created = OrganizationId.create();
    const restored = OrganizationId.from(created);
    expect(restored).toBe(created);
  });

  it('rejects a malformed id', () => {
    expect(() => OrganizationId.from('tenant_1')).toThrow(InvalidOrganizationValueError);
    expect(() => OrganizationId.from('org_short')).toThrow(InvalidOrganizationValueError);
  });
});

describe('OrganizationName', () => {
  it('creates and trims a valid name', () => {
    const name = OrganizationName.create('  Acme Corp  ');
    expect(name.value).toBe('Acme Corp');
  });

  it('compares by value', () => {
    expect(OrganizationName.create('Acme').equals(OrganizationName.create('Acme'))).toBe(true);
    expect(OrganizationName.create('Acme').equals(OrganizationName.create('Acme2'))).toBe(false);
  });

  it('rejects an empty name', () => {
    expect(() => OrganizationName.create('   ')).toThrow(InvalidOrganizationValueError);
  });

  it('rejects an over-long name', () => {
    expect(() => OrganizationName.create('x'.repeat(MAX_ORGANIZATION_NAME_LENGTH + 1))).toThrow(
      InvalidOrganizationValueError,
    );
  });

  it('accepts the maximum length name', () => {
    expect(OrganizationName.create('x'.repeat(MAX_ORGANIZATION_NAME_LENGTH)).value).toHaveLength(
      MAX_ORGANIZATION_NAME_LENGTH,
    );
  });
});

describe('OrganizationSlug', () => {
  it('creates and normalizes a valid slug', () => {
    const slug = OrganizationSlug.create('  Acme-Corp  ');
    expect(slug.value).toBe('acme-corp');
  });

  it('accepts digits and multiple dashes', () => {
    expect(OrganizationSlug.create('acme-2-corp-2024').value).toBe('acme-2-corp-2024');
  });

  it('compares by value', () => {
    expect(OrganizationSlug.create('acme').equals(OrganizationSlug.create('acme'))).toBe(true);
  });

  it('rejects empty and whitespace slugs', () => {
    expect(() => OrganizationSlug.create('')).toThrow(InvalidOrganizationValueError);
    expect(() => OrganizationSlug.create('   ')).toThrow(InvalidOrganizationValueError);
  });

  it('rejects slugs shorter than the minimum', () => {
    expect(() => OrganizationSlug.create('ab')).toThrow(InvalidOrganizationValueError);
    expect(() => OrganizationSlug.create('a'.repeat(MIN_SLUG_LENGTH - 1))).toThrow(
      InvalidOrganizationValueError,
    );
  });

  it('rejects slugs longer than the maximum', () => {
    expect(() => OrganizationSlug.create('a'.repeat(MAX_SLUG_LENGTH + 1))).toThrow(
      InvalidOrganizationValueError,
    );
  });

  it('rejects uppercase, spaces, and symbols', () => {
    expect(() => OrganizationSlug.create('Acme Corp')).toThrow(InvalidOrganizationValueError);
    expect(() => OrganizationSlug.create('acme_corp')).toThrow(InvalidOrganizationValueError);
    expect(() => OrganizationSlug.create('acme.corp')).toThrow(InvalidOrganizationValueError);
    expect(() => OrganizationSlug.create('-acme')).toThrow(InvalidOrganizationValueError);
    expect(() => OrganizationSlug.create('acme-')).toThrow(InvalidOrganizationValueError);
  });

  it('accepts the exact minimum and maximum lengths', () => {
    expect(OrganizationSlug.create('a'.repeat(MIN_SLUG_LENGTH)).value).toHaveLength(
      MIN_SLUG_LENGTH,
    );
    expect(OrganizationSlug.create('a'.repeat(MAX_SLUG_LENGTH)).value).toHaveLength(
      MAX_SLUG_LENGTH,
    );
  });
});

describe('OrganizationStatus', () => {
  it('exposes all lifecycle statuses', () => {
    expect(ORGANIZATION_STATUSES).toEqual(['provisioning', 'active', 'suspended', 'archived']);
    expect(OrganizationStatus.provisioning().value).toBe('provisioning');
    expect(OrganizationStatus.active().value).toBe('active');
    expect(OrganizationStatus.suspended().value).toBe('suspended');
    expect(OrganizationStatus.archived().value).toBe('archived');
  });

  it('is active only for the active status', () => {
    expect(OrganizationStatus.active().isActive()).toBe(true);
    expect(OrganizationStatus.provisioning().isActive()).toBe(false);
    expect(OrganizationStatus.suspended().isActive()).toBe(false);
    expect(OrganizationStatus.archived().isActive()).toBe(false);
  });

  it('parses valid status strings', () => {
    for (const status of ORGANIZATION_STATUSES) {
      expect(OrganizationStatus.from(status).value).toBe(status);
    }
  });

  it('rejects an unknown status string', () => {
    expect(() => OrganizationStatus.from('deleted')).toThrow(InvalidOrganizationValueError);
    expect(() => OrganizationStatus.from('')).toThrow(InvalidOrganizationValueError);
  });

  it('compares by value', () => {
    expect(OrganizationStatus.active().equals(OrganizationStatus.active())).toBe(true);
    expect(OrganizationStatus.active().equals(OrganizationStatus.suspended())).toBe(false);
  });
});

describe('OrganizationType', () => {
  it('exposes all provisioning types', () => {
    expect(ORGANIZATION_TYPES).toContain('enterprise');
    expect(ORGANIZATION_TYPES).toContain('smb');
    expect(ORGANIZATION_TYPES).toContain('startup');
    expect(OrganizationType.enterprise().value).toBe('enterprise');
    expect(OrganizationType.smb().value).toBe('smb');
    expect(OrganizationType.startup().value).toBe('startup');
    expect(OrganizationType.nonProfit().value).toBe('non_profit');
    expect(OrganizationType.government().value).toBe('government');
    expect(OrganizationType.other().value).toBe('other');
  });

  it('parses valid type strings', () => {
    for (const type of ORGANIZATION_TYPES) {
      expect(OrganizationType.from(type).value).toBe(type);
    }
  });

  it('rejects an unknown type string', () => {
    expect(() => OrganizationType.from('retail')).toThrow(InvalidOrganizationValueError);
  });

  it('compares by value', () => {
    expect(OrganizationType.startup().equals(OrganizationType.startup())).toBe(true);
    expect(OrganizationType.startup().equals(OrganizationType.enterprise())).toBe(false);
  });
});
