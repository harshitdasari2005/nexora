/**
 * @nexora/domain-organizations — MembershipDomainService.
 *
 * Orchestrates the {@link OrganizationMembership} aggregate (DOMAIN_MODEL.md
 * §1 Tenancy; PSD.md §4 WS-R2): adding, removing, and re-rolling members.
 * Cross-aggregate invariants live here — organization-status gating and the
 * last-owner rule require the organization aggregate plus membership counts
 * (docs/AGGREGATES.md).
 */

import type { EventEnvelope } from '@nexora/shared/events';
import type { Result } from '@nexora/shared/result';
import { ok, err } from '@nexora/shared/result';
import type { UserId } from '@nexora/contracts/common';

import type { OrganizationEventContext } from '../events/index.js';
import { memberRemovedEvent } from '../events/index.js';
import { OrganizationMembership } from '../entities/organization-membership.js';
import type { MembershipRole } from '../entities/organization-membership.js';
import type {
  InvalidOrganizationValueError,
  LastOwnerRemovalError,
  OrganizationArchivedError,
  OrganizationNotActiveError,
} from '../errors/index.js';
import {
  MemberAlreadyExistsError,
  MemberNotFoundError,
  OrganizationNotFoundError,
  toOrganizationError,
} from '../errors/index.js';
import type { MembershipRepository, OrganizationRepository } from '../repositories/index.js';
import { MembershipPolicy } from '../policies/index.js';
import type { OrganizationId } from '../value-objects/organization-id.js';

/** The outcome of a membership command: the aggregate plus emitted events. */
export interface MembershipCommandResult {
  /** The mutated membership aggregate. */
  membership: OrganizationMembership;
  /** Domain events emitted by the operation (publish via the event bus). */
  events: readonly EventEnvelope[];
}

/** Dependencies of the {@link MembershipDomainService}. */
export interface MembershipDomainServiceDependencies {
  /** Membership persistence. */
  memberships: MembershipRepository;
  /** Organization persistence (status gating, last-owner count). */
  organizations: OrganizationRepository;
  /** Membership policy (role validity, gating, last-owner rule). */
  membershipPolicy?: MembershipPolicy;
}

/**
 * The membership use-case service. All methods return a `Result` so expected
 * failures are explicit values, not exceptions.
 */
export class MembershipDomainService {
  readonly #memberships: MembershipRepository;
  readonly #organizations: OrganizationRepository;
  readonly #policy: MembershipPolicy;

  constructor(dependencies: MembershipDomainServiceDependencies) {
    this.#memberships = dependencies.memberships;
    this.#organizations = dependencies.organizations;
    this.#policy = dependencies.membershipPolicy ?? new MembershipPolicy();
  }

  /**
   * Adds a user to an organization: the organization must be `active`, the
   * user must not already be a member, and the role must be valid.
   */
  async addMember(
    organizationId: OrganizationId,
    userId: UserId,
    role: MembershipRole,
    context: OrganizationEventContext,
  ): Promise<
    Result<
      MembershipCommandResult,
      | OrganizationNotFoundError
      | OrganizationNotActiveError
      | OrganizationArchivedError
      | MemberAlreadyExistsError
      | InvalidOrganizationValueError
    >
  > {
    try {
      this.#policy.assertValidRole(role);
      const organization = await this.#requireOrganization(organizationId);
      this.#policy.assertCanAddMember(organization.status);

      const existing = await this.#memberships.findByOrganizationAndUser(organizationId, userId);
      if (existing !== undefined) {
        return err(new MemberAlreadyExistsError({ organizationId, userId }));
      }

      const membership = OrganizationMembership.create({ organizationId, userId, role }, context);
      await this.#memberships.save(membership);
      return ok({ membership, events: membership.pullDomainEvents() });
    } catch (error) {
      return err(
        toOrganizationError(error) as
          | OrganizationNotFoundError
          | OrganizationNotActiveError
          | OrganizationArchivedError
          | MemberAlreadyExistsError
          | InvalidOrganizationValueError,
      );
    }
  }

  /**
   * Removes a user from an organization: the membership must exist, the
   * organization must not be archived, and the last owner cannot be removed.
   * Emits `organization.member_removed` (the aggregate holds no removal
   * event; removal is a hard delete — docs/AGGREGATES.md).
   */
  async removeMember(
    organizationId: OrganizationId,
    userId: UserId,
    context: OrganizationEventContext,
  ): Promise<
    Result<
      MembershipCommandResult,
      | OrganizationNotFoundError
      | OrganizationArchivedError
      | MemberNotFoundError
      | LastOwnerRemovalError
    >
  > {
    try {
      const organization = await this.#requireOrganization(organizationId);
      this.#policy.assertCanRemoveMember(organization.status);

      const membership = await this.#memberships.findByOrganizationAndUser(organizationId, userId);
      if (membership === undefined) {
        return err(new MemberNotFoundError({ organizationId, userId }));
      }

      if (membership.isOwner()) {
        this.#policy.assertCanRemoveOwner(await this.#memberships.countOwners(organizationId));
      }

      const events: EventEnvelope[] = [
        memberRemovedEvent(context, {
          organizationId,
          membershipId: membership.id,
          userId,
          role: membership.role,
        }),
      ];
      await this.#memberships.remove(membership);
      return ok({ membership, events });
    } catch (error) {
      return err(
        toOrganizationError(error) as
          | OrganizationNotFoundError
          | OrganizationArchivedError
          | MemberNotFoundError
          | LastOwnerRemovalError,
      );
    }
  }

  /**
   * Changes a member's role: the membership must exist, the organization must
   * not be archived, the role must be valid, and the last owner cannot be
   * demoted. Role changes emit no domain event in v1 (documented); `context`
   * is reserved for the future `member_role_changed` event.
   */
  async changeRole(
    organizationId: OrganizationId,
    userId: UserId,
    newRole: MembershipRole,
    _context: OrganizationEventContext,
  ): Promise<
    Result<
      MembershipCommandResult,
      | OrganizationNotFoundError
      | OrganizationArchivedError
      | MemberNotFoundError
      | LastOwnerRemovalError
      | InvalidOrganizationValueError
    >
  > {
    try {
      this.#policy.assertValidRole(newRole);
      const organization = await this.#requireOrganization(organizationId);
      this.#policy.assertCanRemoveMember(organization.status);

      const membership = await this.#memberships.findByOrganizationAndUser(organizationId, userId);
      if (membership === undefined) {
        return err(new MemberNotFoundError({ organizationId, userId }));
      }

      if (membership.isOwner() && newRole !== 'owner') {
        this.#policy.assertCanRemoveOwner(await this.#memberships.countOwners(organizationId));
      }

      membership.changeRole(newRole);
      await this.#memberships.save(membership);
      return ok({ membership, events: membership.pullDomainEvents() });
    } catch (error) {
      return err(
        toOrganizationError(error) as
          | OrganizationNotFoundError
          | OrganizationArchivedError
          | MemberNotFoundError
          | LastOwnerRemovalError
          | InvalidOrganizationValueError,
      );
    }
  }

  /** Lists the active memberships of an organization. */
  async listByOrganization(
    organizationId: OrganizationId,
  ): Promise<Result<readonly OrganizationMembership[], OrganizationNotFoundError>> {
    const organization = await this.#organizations.findById(organizationId);
    if (organization === undefined) {
      return err(new OrganizationNotFoundError({ organizationId }));
    }
    return ok(await this.#memberships.listByOrganization(organizationId));
  }

  /** Loads an organization or throws {@link OrganizationNotFoundError}. */
  async #requireOrganization(organizationId: OrganizationId) {
    const organization = await this.#organizations.findById(organizationId);
    if (organization === undefined) {
      throw new OrganizationNotFoundError({ organizationId });
    }
    return organization;
  }
}
