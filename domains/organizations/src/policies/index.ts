/**
 * @nexora/domain-organizations — domain policies.
 *
 * The Organizations bounded context business rules (DOMAIN_MODEL.md §1, §13;
 * PSD.md §3 CO-*, §4 WS-*), extracted so the platform can reuse them and so
 * aggregate invariants stay in one authoritative place. Policies are pure:
 * they have no I/O and throw typed domain errors on violation.
 */

import {
  InvalidOrganizationValueError,
  LastOwnerRemovalError,
  OrganizationArchivedError,
  OrganizationNotActiveError,
  OrganizationStateTransitionError,
  SlugAlreadyExistsError,
} from '../errors/index.js';
import { MEMBERSHIP_ROLES, type MembershipRole } from '../value-objects/membership-role.js';
import type { OrganizationStatusValue } from '../value-objects/organization-status.js';
import { type OrganizationStatus } from '../value-objects/organization-status.js';

/**
 * The organization lifecycle transition table (PSD.md CO-3: Provisioning →
 * Active → Suspended → Archived; `archived` is terminal in v1). The single
 * authoritative definition — the Organization aggregate and all policies
 * consult it.
 */
export const ORG_TRANSITIONS: Readonly<
  Record<OrganizationStatusValue, readonly OrganizationStatusValue[]>
> = {
  provisioning: ['active'],
  active: ['suspended', 'archived'],
  suspended: ['active', 'archived'],
  archived: [],
};

/**
 * Organization lifecycle rules: allowed status transitions and activity
 * checks (PSD.md CO-3, CO-B4).
 */
export class OrganizationLifecyclePolicy {
  /** The statuses reachable from the given status. */
  allowedTargets(current: OrganizationStatus): readonly OrganizationStatusValue[] {
    return ORG_TRANSITIONS[current.value];
  }

  /**
   * Asserts the organization may transition to the target status.
   *
   * @throws {OrganizationStateTransitionError} when the transition is not allowed.
   */
  assertCanTransition(current: OrganizationStatus, target: OrganizationStatus): void {
    const allowed = this.allowedTargets(current);
    if (!allowed.includes(target.value)) {
      throw new OrganizationStateTransitionError(
        `Cannot transition an organization from ${current.value} to ${target.value}`,
        { from: current.value, to: target.value },
      );
    }
  }

  /**
   * Asserts the organization is `active`.
   *
   * @throws {OrganizationNotActiveError} when the organization is not active.
   */
  assertIsActive(status: OrganizationStatus): void {
    if (!status.isActive()) {
      throw new OrganizationNotActiveError({ status: status.value });
    }
  }
}

/**
 * Organization archival rules (PSD.md CO-3; docs/LIFECYCLE.md). Archival is
 * allowed from `active` and `suspended`; an archived organization is terminal
 * and rejects every mutation (settings, profile, memberships).
 */
export class OrganizationArchivalPolicy {
  /**
   * Asserts the organization may be archived.
   *
   * @throws {OrganizationStateTransitionError} when archival is not allowed.
   */
  assertCanArchive(status: OrganizationStatus): void {
    if (status.value !== 'active' && status.value !== 'suspended') {
      throw new OrganizationStateTransitionError(
        `Cannot archive an organization in status ${status.value}`,
        { status: status.value },
      );
    }
  }

  /**
   * Asserts the organization is not archived (mutations allowed).
   *
   * @throws {OrganizationArchivedError} when the organization is archived.
   */
  assertCanMutate(status: OrganizationStatus): void {
    if (status.value === 'archived') {
      throw new OrganizationArchivedError({ status: status.value });
    }
  }
}

/**
 * Membership invariants (PSD.md §4 WS-R2, §10 roles): role validity,
 * organization-status gating for membership changes, and last-owner
 * protection.
 */
export class MembershipPolicy {
  /**
   * Asserts a membership role is valid.
   *
   * @throws {InvalidOrganizationValueError} when the role is unknown.
   */
  assertValidRole(role: MembershipRole): void {
    if (!MEMBERSHIP_ROLES.includes(role)) {
      throw new InvalidOrganizationValueError('Invalid membership role', [
        { path: 'role', message: `Must be one of: ${MEMBERSHIP_ROLES.join(', ')}` },
      ]);
    }
  }

  /**
   * Asserts a new member may be added: the organization must be `active`
   * (suspended and provisioning organizations are frozen; archived
   * organizations reject everything).
   *
   * @throws {OrganizationArchivedError}    when the organization is archived.
   * @throws {OrganizationNotActiveError}   when the organization is not active.
   */
  assertCanAddMember(status: OrganizationStatus): void {
    if (status.value === 'archived') {
      throw new OrganizationArchivedError({ status: status.value });
    }
    if (!status.isActive()) {
      throw new OrganizationNotActiveError({ status: status.value });
    }
  }

  /**
   * Asserts a member may be removed: allowed while the organization is not
   * archived (active, suspended, or provisioning cleanup).
   *
   * @throws {OrganizationArchivedError} when the organization is archived.
   */
  assertCanRemoveMember(status: OrganizationStatus): void {
    if (status.value === 'archived') {
      throw new OrganizationArchivedError({ status: status.value });
    }
  }

  /**
   * Asserts the last owner of an organization is not removed or demoted: an
   * organization must always retain at least one `owner`.
   *
   * @param ownerCount - current number of owners.
   * @throws {LastOwnerRemovalError} when `ownerCount` is 1.
   */
  assertCanRemoveOwner(ownerCount: number): void {
    if (ownerCount <= 1) {
      throw new LastOwnerRemovalError({ ownerCount });
    }
  }
}

/**
 * Slug uniqueness policy — the domain contract that slugs are globally
 * unique (docs/BUSINESS_RULES.md). The rule is enforced in the domain via the
 * repository port (`existsBySlug`) and in the infrastructure layer via a
 * unique index; this policy is the single statement of the contract.
 */
export class SlugUniquenessPolicy {
  /**
   * Asserts a slug is available.
   *
   * @param exists - whether the repository already holds the slug.
   * @throws {SlugAlreadyExistsError} when the slug is taken.
   */
  assertSlugAvailable(exists: boolean): void {
    if (exists) {
      throw new SlugAlreadyExistsError();
    }
  }
}
