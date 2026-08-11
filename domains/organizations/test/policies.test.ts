/**
 * Organization policy tests: lifecycle transitions, archival rules, membership
 * invariants, and the slug uniqueness contract.
 */

import { describe, expect, it } from 'vitest';

import {
  InvalidOrganizationValueError,
  LastOwnerRemovalError,
  OrganizationArchivedError,
  OrganizationNotActiveError,
  OrganizationStateTransitionError,
  SlugAlreadyExistsError,
} from '../src/errors/index.js';
import {
  MembershipPolicy,
  ORG_TRANSITIONS,
  OrganizationArchivalPolicy,
  OrganizationLifecyclePolicy,
  SlugUniquenessPolicy,
} from '../src/policies/index.js';
import { OrganizationStatus } from '../src/value-objects/organization-status.js';

describe('OrganizationLifecyclePolicy', () => {
  const policy = new OrganizationLifecyclePolicy();

  it('defines the transition table', () => {
    expect(ORG_TRANSITIONS).toEqual({
      provisioning: ['active'],
      active: ['suspended', 'archived'],
      suspended: ['active', 'archived'],
      archived: [],
    });
  });

  it('allows every valid transition', () => {
    expect(() =>
      policy.assertCanTransition(OrganizationStatus.provisioning(), OrganizationStatus.active()),
    ).not.toThrow();
    expect(() =>
      policy.assertCanTransition(OrganizationStatus.active(), OrganizationStatus.suspended()),
    ).not.toThrow();
    expect(() =>
      policy.assertCanTransition(OrganizationStatus.active(), OrganizationStatus.archived()),
    ).not.toThrow();
    expect(() =>
      policy.assertCanTransition(OrganizationStatus.suspended(), OrganizationStatus.active()),
    ).not.toThrow();
    expect(() =>
      policy.assertCanTransition(OrganizationStatus.suspended(), OrganizationStatus.archived()),
    ).not.toThrow();
  });

  it('rejects every invalid transition', () => {
    expect(() =>
      policy.assertCanTransition(OrganizationStatus.provisioning(), OrganizationStatus.suspended()),
    ).toThrow(OrganizationStateTransitionError);
    expect(() =>
      policy.assertCanTransition(OrganizationStatus.provisioning(), OrganizationStatus.archived()),
    ).toThrow(OrganizationStateTransitionError);
    expect(() =>
      policy.assertCanTransition(OrganizationStatus.active(), OrganizationStatus.active()),
    ).toThrow(OrganizationStateTransitionError);
    expect(() =>
      policy.assertCanTransition(OrganizationStatus.archived(), OrganizationStatus.active()),
    ).toThrow(OrganizationStateTransitionError);
    expect(() =>
      policy.assertCanTransition(OrganizationStatus.archived(), OrganizationStatus.suspended()),
    ).toThrow(OrganizationStateTransitionError);
  });

  it('assertIsActive passes for active and fails otherwise', () => {
    expect(() => policy.assertIsActive(OrganizationStatus.active())).not.toThrow();
    expect(() => policy.assertIsActive(OrganizationStatus.provisioning())).toThrow(
      OrganizationNotActiveError,
    );
    expect(() => policy.assertIsActive(OrganizationStatus.suspended())).toThrow(
      OrganizationNotActiveError,
    );
    expect(() => policy.assertIsActive(OrganizationStatus.archived())).toThrow(
      OrganizationNotActiveError,
    );
  });
});

describe('OrganizationArchivalPolicy', () => {
  const policy = new OrganizationArchivalPolicy();

  it('allows archiving active and suspended organizations', () => {
    expect(() => policy.assertCanArchive(OrganizationStatus.active())).not.toThrow();
    expect(() => policy.assertCanArchive(OrganizationStatus.suspended())).not.toThrow();
  });

  it('rejects archiving provisioning and archived organizations', () => {
    expect(() => policy.assertCanArchive(OrganizationStatus.provisioning())).toThrow(
      OrganizationStateTransitionError,
    );
    expect(() => policy.assertCanArchive(OrganizationStatus.archived())).toThrow(
      OrganizationStateTransitionError,
    );
  });

  it('rejects mutations on archived organizations', () => {
    expect(() => policy.assertCanMutate(OrganizationStatus.archived())).toThrow(
      OrganizationArchivedError,
    );
    expect(() => policy.assertCanMutate(OrganizationStatus.active())).not.toThrow();
    expect(() => policy.assertCanMutate(OrganizationStatus.suspended())).not.toThrow();
    expect(() => policy.assertCanMutate(OrganizationStatus.provisioning())).not.toThrow();
  });
});

describe('MembershipPolicy', () => {
  const policy = new MembershipPolicy();

  it('accepts all valid roles', () => {
    for (const role of ['owner', 'admin', 'member'] as const) {
      expect(() => policy.assertValidRole(role)).not.toThrow();
    }
  });

  it('rejects an invalid role', () => {
    expect(() => policy.assertValidRole('superadmin' as never)).toThrow(
      InvalidOrganizationValueError,
    );
  });

  it('allows adding members only to active organizations', () => {
    expect(() => policy.assertCanAddMember(OrganizationStatus.active())).not.toThrow();
    expect(() => policy.assertCanAddMember(OrganizationStatus.provisioning())).toThrow(
      OrganizationNotActiveError,
    );
    expect(() => policy.assertCanAddMember(OrganizationStatus.suspended())).toThrow(
      OrganizationNotActiveError,
    );
    expect(() => policy.assertCanAddMember(OrganizationStatus.archived())).toThrow(
      OrganizationArchivedError,
    );
  });

  it('allows removing members from any non-archived organization', () => {
    expect(() => policy.assertCanRemoveMember(OrganizationStatus.active())).not.toThrow();
    expect(() => policy.assertCanRemoveMember(OrganizationStatus.suspended())).not.toThrow();
    expect(() => policy.assertCanRemoveMember(OrganizationStatus.provisioning())).not.toThrow();
    expect(() => policy.assertCanRemoveMember(OrganizationStatus.archived())).toThrow(
      OrganizationArchivedError,
    );
  });

  it('protects the last owner', () => {
    expect(() => policy.assertCanRemoveOwner(2)).not.toThrow();
    expect(() => policy.assertCanRemoveOwner(1)).toThrow(LastOwnerRemovalError);
    expect(() => policy.assertCanRemoveOwner(0)).toThrow(LastOwnerRemovalError);
  });
});

describe('SlugUniquenessPolicy', () => {
  const policy = new SlugUniquenessPolicy();

  it('accepts an available slug', () => {
    expect(() => policy.assertSlugAvailable(false)).not.toThrow();
  });

  it('rejects a taken slug', () => {
    expect(() => policy.assertSlugAvailable(true)).toThrow(SlugAlreadyExistsError);
  });
});
